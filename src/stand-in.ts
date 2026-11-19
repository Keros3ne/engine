/**
 * A game played alone: a stand-in for a site, for playing a game before it is sent. It is
 * what `keros3ne-studio dev` plays a client against. A balance, a pair of seeds, the
 * player's progress at each bet and their history are kept in memory (./memory.ts), and
 * every round is played by the bet pipeline a site plays it by (./pipeline.ts): the same
 * checks, the same charge, the same draw, the same refusals. There is no second set of
 * rules here to keep in step. State is stored as JSON between steps, as a site stores it,
 * so a game that keeps something JSON cannot is caught here too.
 *
 * What it does not do: a site's rewards (levels, rakeback, packs), its rate limits, and
 * its database. A round still open when the stand-in is made again is gone.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import { stakeLimits } from "./bets.ts";
import type { StudioGame } from "./maths.ts";
import { createMemoryStore } from "./memory.ts";
import {
	BetRejectedError,
	InsufficientFundsError,
	RoundProblem,
	createPipeline,
	type RoundResult
} from "./pipeline.ts";
import { inProcess } from "./play.ts";
import type { HistoryBet, InitMessage, RoundMessage } from "./protocol.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStudioGame = StudioGame<any, any, any, any, any, any, any>;

export type Reply =
	| { ok: true; round: RoundMessage }
	| { ok: false; reason: "insufficient" | "rejected"; message: string };

export interface Fairness {
	serverSeedHash: string;
	clientSeed: string;
	/** Bets placed on this pair so far. */
	nonce: number;
}

/** The one player a stand-in has. */
const PLAYER = "player";
/** How many settled bets a game is shown of its history. */
const HISTORY = 20;

const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/** What a game is told of a round, from what the pipeline made of it. */
const told = (round: RoundResult<never>): RoundMessage => ({
	open: round.open,
	stake: round.stake,
	baseStake: round.baseStake,
	payout: round.payout,
	view: stored(round.view),
	progress: round.progress ?? null,
	balance: round.balance
});

/** A stand-in for a site, with one game to play and a balance to play it with. */
export function createStandIn(game: AnyStudioGame, options: { balance?: number } = {}) {
	const memory = createMemoryStore(options);
	const { store } = memory;
	// A studio's game: its bet is one its steps reach, as on a site.
	const played = { ...game, studio: game.studio ?? "studio" };
	const maths = inProcess(game);
	const pipeline = createPipeline<typeof played>({
		find: (slug) => (slug === game.slug ? played : undefined),
		maths: () => maths
	});
	const limits = stakeLimits(game);

	/** Runs one step; a refusal or a broken game becomes a refusal, and changes nothing. */
	async function step(work: () => Promise<RoundResult<never>>): Promise<Reply> {
		const before = memory.snapshot();

		try {
			return { ok: true, round: told(await work()) };
		} catch (error) {
			memory.restore(before);

			if (error instanceof InsufficientFundsError)
				return {
					ok: false,
					reason: "insufficient",
					message: "Not enough KC for that bet."
				};
			if (error instanceof BetRejectedError || error instanceof RoundProblem)
				return { ok: false, reason: "rejected", message: error.message };

			// On a site this is a failed request, not a refusal: the game is broken.
			return {
				ok: false,
				reason: "rejected",
				message: `The game broke a rule of the site: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}

	/** The round left open, as the game would be told it when it loads. */
	async function round(): Promise<RoundMessage | null> {
		const open = await pipeline.currentRound(store, PLAYER, game.slug);

		return open && told(open);
	}

	return {
		limits,
		get balance() {
			return memory.balance;
		},
		round,
		get fairness(): Fairness {
			return memory.fairness;
		},

		async init(reducedMotion: boolean): Promise<InitMessage> {
			return {
				game: { slug: game.slug, name: game.name },
				balance: memory.balance,
				limits,
				reducedMotion,
				round: await round()
			};
		},

		/** Opens a round at a bet. A way of playing that costs more is charged the bet times its `costBp`. */
		open(stake: number, params: unknown): Promise<Reply> {
			return step(() =>
				pipeline.openRound(store, {
					userId: PLAYER,
					game: game.slug,
					stake,
					params
				})
			);
		},

		act(action: unknown): Promise<Reply> {
			return step(() =>
				pipeline.actInRound(store, { userId: PLAYER, game: game.slug, action })
			);
		},

		progress(stake: number): Promise<unknown> {
			return pipeline.progressView(store, PLAYER, game.slug, stake);
		},

		history(): HistoryBet[] {
			return memory
				.settledBets()
				.slice(0, HISTORY)
				.map((bet) => ({
					stake: bet.stake,
					payout: bet.settled!.payout,
					multiplierBp: bet.settled!.multiplierBp,
					at: (bet.settledAt ?? bet.createdAt).getTime()
				}));
		},

		/** Sets the pretend balance, as a claim or a refuel would change it on a site. */
		setBalance(cents: number) {
			memory.setBalance(cents);
		},

		/**
		 * A new pair of seeds, as a player can ask for on a site. Returns the old server seed,
		 * now revealed, or `null` while a round is open, whose seeds are still in use.
		 */
		rotateSeeds(): string | null {
			return memory.rotateSeeds();
		}
	};
}

export type StandIn = ReturnType<typeof createStandIn>;
