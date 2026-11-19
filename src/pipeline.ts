/**
 * The bet pipeline: how a bet is played, whatever the game and wherever it is kept. A bet
 * is checked, charged, drawn from its seeds, settled to whole cents and put on record, and
 * a round is opened, moved in and concluded, here and nowhere else. A site plays every bet
 * through this, and so does a game played alone on a studio's own machine (./table.ts), so
 * a game behaves in one as it will in the other: there is one set of rules.
 *
 * What it does not know is where anything is kept. A balance, a pair of seeds, a bet's
 * record and a game's meters are asked of a `BetStore`, which a site makes over its
 * database, inside a transaction of its own that locks the player, and which ./memory.ts
 * makes in memory. A step that throws must leave nothing behind: a site's transaction is
 * undone, and the store in memory is put back as it was.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import * as v from "valibot";
import type { Concluded, Seeds } from "./answers.ts";
import { BP, chargeFor, settlePayout, stakeLimits, stakeOffered } from "./bets.ts";
import { GameFailedError } from "./game-failed.ts";
import { formatKero } from "./kero.ts";
import { ROUND_MAX_ACTIONS, fitsInStore } from "./limits.ts";
import type { StakeSteps } from "./stake-steps.ts";
import type { Rng } from "./rng.ts";
import { createRng, payoutRoll } from "./rng.ts";
import type { RoundMaths } from "./play.ts";

/** A bet the player asked for that cannot be placed. The message is shown to them. */
export class BetRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BetRejectedError";
	}
}

/**
 * Thrown by a store that cannot take what a bet costs from the player's balance. Opening a
 * bet, it is thrown on through: a site answers it by offering more KC. A move in a round
 * that cannot be paid for is a `RoundProblem`.
 */
export class InsufficientFundsError extends Error {
	constructor() {
		super("Not enough KC.");
		this.name = "InsufficientFundsError";
	}
}

/** A move in a round that cannot be made. The round is left as it was, and the player told why. */
export class RoundProblem extends Error {}

/** What every game says of itself, as far as the pipeline asks. */
interface AnyGame {
	slug: string;
	kind?: string;
	/** A studio's game names its studio: its bet is one its bar steps to, never typed. */
	studio?: string;
	minStake?: number;
	maxStake?: number;
	steps?: StakeSteps;
}

/** A game settled in one step: the site's own table games. */
export interface InstantPlay extends AnyGame {
	kind: "instant";
	params: v.GenericSchema<unknown, unknown>;
	play(params: unknown, rng: Rng): { result: unknown; multiplierBp: number };
}

/** A game played as a round: the site's own, or a studio's from its books. */
export interface RoundPlay extends AnyGame {
	kind?: "round";
}

/** A round in progress, as a store keeps it. */
export interface OpenBet {
	id: string;
	userId: string;
	game: string;
	/** Everything staked in the round so far, in cents. */
	stake: number;
	/** The bet it was opened at, which its wins are paid on. */
	baseStake: number;
	nonce: number;
	/** The player's actions, as the game keeps them. */
	state: unknown;
	/** How many moves have been made. */
	actions: number;
	/** The store's own name for the pair of seeds the round is played on. */
	seedsRef: string;
}

/** A bet as it is first put on record. */
export interface NewBet {
	id: string;
	userId: string;
	game: string;
	stake: number;
	baseStake: number;
	seedsRef: string;
	nonce: number;
	params: unknown;
	createdAt: Date;
	/** A round's first state, for a bet left open; a settled bet has what it came to. */
	state?: unknown;
	settled?: { payout: number; multiplierBp: number; result: unknown };
}

/** What changes of a round's record as it is played. */
export interface BetChange {
	state: unknown;
	stake: number;
	actions: number;
	/** Set when the round is over. */
	settled?: { payout: number; multiplierBp: number; result: unknown; at: Date };
}

/** A bet that has just settled, as a store is told of it. */
export interface SettledBet<Game> {
	id: string;
	userId: string;
	game: Game;
	/** Everything staked in it. */
	stake: number;
	/** What it paid, of everything staked, in basis points. */
	multiplierBp: number;
	now: Date;
}

/**
 * Where a bet's things are kept. Every method is asked inside the one step it belongs to;
 * a store over a database is made on the transaction that step runs in.
 */
export interface BetStore<Extra = never, Game = unknown> {
	/** A new id for a bet. */
	newId(): string;
	/** The player's seeds for this game, with the next nonce taken. */
	takeSeeds(userId: string, game: string, now: Date): Promise<Seeds & { ref: string }>;
	/** The seeds a bet on record is played on. */
	seedsOf(bet: { seedsRef: string; nonce: number }): Promise<Seeds>;
	/** Takes an amount from the balance, for a bet. Throws `InsufficientFundsError` if it is not there. */
	charge(userId: string, amount: number, betId: string, now: Date): Promise<void>;
	/** Adds a bet's payout to the balance. */
	pay(userId: string, amount: number, betId: string, now: Date): Promise<void>;
	balance(userId: string): Promise<number>;
	/** The player's round in progress in a game, if there is one. */
	openBet(userId: string, game: string): Promise<OpenBet | undefined>;
	record(bet: NewBet): Promise<void>;
	change(betId: string, change: BetChange): Promise<void>;
	/** What a game has kept for the player at a bet, or `undefined` if nothing yet. */
	progress(userId: string, game: string, stake: number): Promise<unknown | undefined>;
	keepProgress(
		userId: string,
		game: string,
		stake: number,
		state: unknown,
		now: Date
	): Promise<void>;
	/**
	 * A bet has settled: whatever else a site gives for one (level progress, a dropped
	 * pack), in the same step. What it returns goes back with the bet.
	 */
	settled?(bet: SettledBet<Game>): Promise<Extra | null>;
}

/** What a bet is asked with. */
export interface BetInput {
	userId: string;
	game: string;
	/**
	 * The bet, in cents. A round opened a way that costs more (a boosted spin, a bought
	 * bonus) is charged the bet times its cost; its wins are paid on the bet.
	 */
	stake: number;
	params: unknown;
	now?: Date;
}

/** A bet on a game settled in one step, as it came out. */
export interface InstantResult<Extra> {
	id: string;
	extra: Extra | null;
	game: string;
	stake: number;
	payout: number;
	multiplierBp: number;
	result: unknown;
	nonce: number;
	balance: number;
}

/** A round after a step: what the player sees, and whether it is over. */
export interface RoundResult<Extra> {
	id: string;
	open: boolean;
	stake: number;
	baseStake: number;
	payout: number;
	extra: Extra | null;
	view: unknown;
	/** For a game that keeps progress: where it stands at this bet after this step. */
	progress: unknown;
	balance: number;
}

/**
 * The pipeline over a site's games. `find` names a game by its slug; `maths` is what
 * answers for a round game (./play.ts).
 */
export function createPipeline<Game extends AnyGame, Extra = never>(options: {
	find(slug: string): Game | undefined;
	maths(game: Game): RoundMaths;
}) {
	type Store = BetStore<Extra, Game>;
	const { find, maths: mathsOf } = options;

	const isInstant = (game: AnyGame): game is InstantPlay => game.kind === "instant";

	/**
	 * Checks shared by every kind of bet. Returns the game, its options checked, and what
	 * the round costs in cents: the bet times the way it is played.
	 */
	async function check(input: BetInput, kind: "instant" | "round") {
		const game = find(input.game);
		if (!game || (game.kind === "instant") !== (kind === "instant"))
			throw new BetRejectedError("That game does not exist.");

		// A round game's options are checked by the game: for a studio's, by what its books offer.
		let checked: { params: unknown; costBp: number } | null;
		if (isInstant(game)) {
			const parsed = v.safeParse(game.params, input.params);
			// A game settled in one step is always played for one bet.
			checked = parsed.success ? { params: parsed.output, costBp: BP } : null;
		} else {
			checked = await mathsOf(game).check(input.params);
		}
		if (!checked) throw new BetRejectedError("Those bet options are not valid.");

		const { stake } = input;
		const { minStake, maxStake } = stakeLimits(game);
		if (!Number.isSafeInteger(stake) || stake < minStake)
			throw new BetRejectedError(
				`The smallest bet on this game is ${formatKero(minStake)}.`
			);
		if (stake > maxStake)
			throw new BetRejectedError(
				`The largest bet on this game is ${formatKero(maxStake)}.`
			);
		// A studio's game never has its bet typed: a bet its bar's steps do not reach did not
		// come from the game, and its meters are kept for each bet it offers.
		if (game.studio && !stakeOffered(game, stake))
			throw new BetRejectedError("That bet is not one this game offers.");

		// What the maths says a round costs is checked like anything else from outside.
		const charge = chargeFor(stake, checked.costBp);
		if (charge === null) {
			if (!Number.isSafeInteger(checked.costBp) || checked.costBp < BP)
				throw new GameFailedError(
					`${game.slug} asked for a cost of ${checked.costBp}`
				);

			throw new BetRejectedError(
				"That way of playing cannot be bet at this amount."
			);
		}

		return { game, params: checked.params, charge };
	}

	/** What a game has kept for this player at this bet, or what a new player starts with. */
	async function progressOf(
		store: Store,
		game: Game,
		userId: string,
		stake: number
	): Promise<unknown> {
		const maths = mathsOf(game);
		if (!maths.keepsProgress) return undefined;

		const kept = await store.progress(userId, game.slug, stake);

		return kept === undefined ? maths.initialProgress() : kept;
	}

	/**
	 * Settles the round if the game says it is over, and returns what the player sees
	 * either way. Every call makes a fresh stream from the bet's seeds, which is how the
	 * game finds the same hidden things each time.
	 */
	async function conclude(
		store: Store,
		game: Game,
		bet: OpenBet,
		now: Date
	): Promise<RoundResult<Extra>> {
		const seeds = await store.seedsOf(bet);
		const maths = mathsOf(game);

		// What a game asks to have stored is not trusted to stay small.
		if (!fitsInStore(bet.state))
			throw new Error(`${game.slug} asked to store too large a round`);

		const before = maths.keepsProgress
			? await progressOf(store, game, bet.userId, bet.baseStake)
			: undefined;
		const concluded: Concluded = await maths.conclude(bet.state, seeds, before);
		const { outcome } = concluded;
		// A payout is a whole number of basis points, never less than nothing, whoever's maths says it.
		if (outcome && (!Number.isSafeInteger(outcome.payoutBp) || outcome.payoutBp < 0))
			throw new GameFailedError(`${game.slug} paid ${outcome.payoutBp}`);

		let payout = 0;
		let extra: Extra | null = null;
		let settled: BetChange["settled"];

		if (outcome) {
			payout = settlePayout(
				bet.baseStake,
				outcome.payoutBp,
				payoutRoll(seeds.serverSeed, seeds.clientSeed, seeds.nonce)
			);
			if (payout > 0) await store.pay(bet.userId, payout, bet.id, now);

			// Of everything staked, so a doubled hand that wins shows 2x, not 4x.
			const multiplierBp = Math.floor((payout * 10_000) / bet.stake);
			// Counted once, when the round ends, on everything staked in it.
			extra =
				(await store.settled?.({
					id: bet.id,
					userId: bet.userId,
					game,
					stake: bet.stake,
					multiplierBp,
					now
				})) ?? null;

			// What the game keeps between bets moves on, once, with the round that settled.
			if (maths.keepsProgress) {
				if (!fitsInStore(concluded.progress))
					throw new Error(`${game.slug} asked to store too much progress`);

				await store.keepProgress(
					bet.userId,
					game.slug,
					bet.baseStake,
					concluded.progress,
					now
				);
			}

			settled = { payout, multiplierBp, result: outcome.result, at: now };
		}

		await store.change(bet.id, {
			state: bet.state,
			stake: bet.stake,
			actions: bet.actions,
			...(settled && { settled })
		});

		return {
			id: bet.id,
			open: !outcome,
			stake: bet.stake,
			baseStake: bet.baseStake,
			payout,
			extra,
			view: concluded.view,
			progress: concluded.progressView,
			balance: await store.balance(bet.userId)
		};
	}

	return {
		/** The checks a bet is held to before anything is taken: for a site that makes them before its transaction. */
		check,

		/** A bet on a game settled in one step. */
		async placeInstant(store: Store, input: BetInput): Promise<InstantResult<Extra>> {
			const { userId, stake, now = new Date() } = input;
			const { game, params } = await check(input, "instant");
			if (!isInstant(game)) throw new BetRejectedError("That game does not exist.");

			const seeds = await store.takeSeeds(userId, game.slug, now);
			const id = store.newId();
			// A balance that is short throws out of the step (`InsufficientFundsError`), which
			// undoes the nonce too.
			await store.charge(userId, stake, id, now);

			const { result, multiplierBp } = game.play(
				params,
				createRng(seeds.serverSeed, seeds.clientSeed, seeds.nonce)
			);
			const payout = settlePayout(
				stake,
				multiplierBp,
				payoutRoll(seeds.serverSeed, seeds.clientSeed, seeds.nonce)
			);

			await store.record({
				id,
				userId,
				game: game.slug,
				stake,
				baseStake: stake,
				seedsRef: seeds.ref,
				nonce: seeds.nonce,
				params,
				createdAt: now,
				settled: { payout, multiplierBp, result }
			});
			if (payout > 0) await store.pay(userId, payout, id, now);

			// Whatever else a bet brings lands in the same step, so the balance below has it.
			const extra =
				(await store.settled?.({ id, userId, game, stake, multiplierBp, now })) ??
				null;

			return {
				id,
				extra,
				game: game.slug,
				stake,
				payout,
				multiplierBp,
				result,
				nonce: seeds.nonce,
				balance: await store.balance(userId)
			};
		},

		/** Opens a round, taking what it costs. A game may settle it at once. */
		async openRound(store: Store, input: BetInput): Promise<RoundResult<Extra>> {
			const { userId, stake, now = new Date() } = input;
			const { game, params, charge } = await check(input, "round");
			const maths = mathsOf(game);

			if (await store.openBet(userId, game.slug))
				throw new BetRejectedError("Finish the round you already have open.");

			const seeds = await store.takeSeeds(userId, game.slug, now);
			const id = store.newId();
			// What the round costs leaves the balance; what it pays is worked out on the bet.
			await store.charge(userId, charge, id, now);

			const state = await maths.start(
				params,
				seeds,
				maths.keepsProgress
					? await progressOf(store, game, userId, stake)
					: undefined
			);
			await store.record({
				id,
				userId,
				game: game.slug,
				stake: charge,
				baseStake: stake,
				seedsRef: seeds.ref,
				nonce: seeds.nonce,
				params,
				createdAt: now,
				state
			});

			return conclude(
				store,
				game,
				{
					id,
					userId,
					game: game.slug,
					stake: charge,
					baseStake: stake,
					nonce: seeds.nonce,
					state,
					actions: 0,
					seedsRef: seeds.ref
				},
				now
			);
		},

		/**
		 * One move in the player's round in progress. Throws `RoundProblem` for a move that
		 * cannot be made, which leaves the round as it was.
		 */
		async actInRound(
			store: Store,
			input: { userId: string; game: string; action: unknown; now?: Date }
		): Promise<RoundResult<Extra>> {
			const { userId, now = new Date() } = input;
			const game = find(input.game);
			if (!game || isInstant(game))
				throw new RoundProblem("That game does not exist.");

			// Two moves sent at once take turns, the second seeing the round the first left.
			const bet = await store.openBet(userId, game.slug);
			if (!bet) throw new RoundProblem("There is no round in progress.");
			// No round needs this many moves. One that does is stuck, and stops here.
			if (bet.actions >= ROUND_MAX_ACTIONS)
				throw new RoundProblem("This round has taken too many moves.");

			// The move is checked by the game's maths as it is played.
			const result = await mathsOf(game).act(
				bet.state,
				input.action,
				await store.seedsOf(bet)
			);
			if ("problem" in result) throw new RoundProblem(result.problem);

			// A double or a split costs another opening stake.
			const stakes = result.extraStakes ?? 0;
			if (!Number.isSafeInteger(stakes) || stakes < 0)
				throw new GameFailedError(`${game.slug} asked for ${stakes} more stakes`);

			const more = stakes * bet.baseStake;
			if (more > 0) {
				try {
					await store.charge(userId, more, bet.id, now);
				} catch (error) {
					if (error instanceof InsufficientFundsError)
						throw new RoundProblem("Not enough KC for that move.");

					throw error;
				}
			}

			return conclude(
				store,
				game,
				{
					...bet,
					state: result.state,
					stake: bet.stake + more,
					actions: bet.actions + 1
				},
				now
			);
		},

		/** The player's round in progress in a game, as they see it: a page loaded again picks it up. */
		async currentRound(
			store: Store,
			userId: string,
			slug: string
		): Promise<RoundResult<Extra> | null> {
			const game = find(slug);
			if (!game || isInstant(game)) return null;

			const bet = await store.openBet(userId, slug);
			if (!bet) return null;

			const maths = mathsOf(game);

			return {
				id: bet.id,
				open: true,
				stake: bet.stake,
				baseStake: bet.baseStake,
				payout: 0,
				extra: null,
				view: await maths.view(bet.state, await store.seedsOf(bet)),
				progress: maths.keepsProgress
					? await maths.progressView(
							await progressOf(store, game, userId, bet.baseStake)
						)
					: null,
				balance: await store.balance(userId)
			};
		},

		/** A player's progress in a game at a bet, as they may see it. `null` for a game that keeps none. */
		async progressView(
			store: Store,
			userId: string,
			slug: string,
			stake: number
		): Promise<unknown> {
			const game = find(slug);
			if (!game || isInstant(game) || !mathsOf(game).keepsProgress) return null;

			return mathsOf(game).progressView(
				await progressOf(store, game, userId, stake)
			);
		}
	};
}

export type Pipeline<Game extends AnyGame, Extra = never> = ReturnType<
	typeof createPipeline<Game, Extra>
>;
