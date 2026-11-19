/**
 * A `BetStore` kept in memory, for one player: the balance, the seeds, the bets and the
 * meters of a game played alone, with no site and no database (./stand-in.ts). The
 * pipeline (./pipeline.ts) asks it exactly what it asks a site's store, so a game played
 * here is held to the same rules.
 *
 * A step that fails must leave nothing behind, as a site's transaction leaves nothing:
 * `snapshot()` before a step and `restore()` after one that threw.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import type { Seeds } from "./answers.ts";
import {
	InsufficientFundsError,
	type BetChange,
	type BetStore,
	type NewBet,
	type OpenBet
} from "./pipeline.ts";
import { hashServerSeed } from "./rng.ts";

/** A bet as it is kept here. */
export interface KeptBet extends NewBet {
	actions: number;
	settledAt?: Date;
}

/** What a store in memory holds, copied: enough to put it back. */
interface Snapshot {
	balance: number;
	serverSeed: string;
	clientSeed: string;
	nonce: number;
	pair: number;
	bets: KeptBet[];
	progress: [string, unknown][];
}

const stored = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/** A new seed: 32 random bytes, in hexadecimal. */
function randomSeed(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);

	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A store in memory for one player, starting with a balance in cents. */
export function createMemoryStore(options: { balance?: number } = {}) {
	let balance = options.balance ?? 25_00;
	let serverSeed = randomSeed();
	let clientSeed = randomSeed().slice(0, 16);
	let nonce = 0;
	// Counts the pairs of seeds there have been: a bet names the pair it was played on.
	let pair = 0;
	let made = 0;
	let bets: KeptBet[] = [];
	const progress = new Map<string, unknown>();

	const seedsAt = (at: number): Seeds => ({ serverSeed, clientSeed, nonce: at });
	const meter = (game: string, stake: number) => `${game} ${stake}`;

	const store: BetStore<never, unknown> = {
		newId: () => `bet-${++made}`,

		async takeSeeds() {
			nonce += 1;

			return { ...seedsAt(nonce), ref: String(pair) };
		},

		// An open round is always on the seeds in use: they are not replaced while it is open.
		async seedsOf(bet) {
			return seedsAt(bet.nonce);
		},

		async charge(_userId, amount) {
			if (amount > balance) throw new InsufficientFundsError();

			balance -= amount;
		},

		async pay(_userId, amount) {
			balance += amount;
		},

		async balance() {
			return balance;
		},

		async openBet(_userId, game): Promise<OpenBet | undefined> {
			const found = bets.find((bet) => bet.game === game && !bet.settled);

			return (
				found && {
					id: found.id,
					userId: found.userId,
					game: found.game,
					stake: found.stake,
					baseStake: found.baseStake,
					nonce: found.nonce,
					state: found.state,
					actions: found.actions,
					seedsRef: found.seedsRef
				}
			);
		},

		async record(bet: NewBet) {
			bets.unshift({
				...bet,
				state: stored(bet.state),
				actions: 0,
				...(bet.settled && { settledAt: bet.createdAt })
			});
		},

		async change(id: string, change: BetChange) {
			const bet = bets.find((each) => each.id === id);
			if (!bet) throw new Error(`There is no bet ${id}.`);

			bet.state = stored(change.state);
			bet.stake = change.stake;
			bet.actions = change.actions;

			if (change.settled) {
				const { at, ...settled } = change.settled;
				bet.settled = settled;
				bet.settledAt = at;
			}
		},

		async progress(_userId, game, stake) {
			return progress.get(meter(game, stake));
		},

		async keepProgress(_userId, game, stake, state) {
			progress.set(meter(game, stake), stored(state));
		}
	};

	return {
		store,

		/** The balance, as it stands. */
		get balance() {
			return balance;
		},

		/** Sets the balance, as a claim or a refuel would change it on a site. */
		setBalance(cents: number) {
			if (!Number.isSafeInteger(cents) || cents < 0)
				throw new RangeError("A balance is whole cents, from 0.");

			balance = cents;
		},

		/** What a player is shown of the seeds in use: the server seed's hash, never the seed. */
		get fairness() {
			return { serverSeedHash: hashServerSeed(serverSeed), clientSeed, nonce };
		},

		/** Settled bets, newest first. */
		settledBets(): KeptBet[] {
			return bets.filter((bet) => bet.settled);
		},

		/** Whether any round is open: its seeds are still in use. */
		get playing(): boolean {
			return bets.some((bet) => !bet.settled);
		},

		/**
		 * A new pair of seeds, as a player can ask for. Returns the old server seed, now
		 * revealed, or `null` while a round is open.
		 */
		rotateSeeds(): string | null {
			if (bets.some((bet) => !bet.settled)) return null;

			const revealed = serverSeed;
			serverSeed = randomSeed();
			clientSeed = randomSeed().slice(0, 16);
			nonce = 0;
			pair += 1;

			return revealed;
		},

		snapshot(): Snapshot {
			return {
				balance,
				serverSeed,
				clientSeed,
				nonce,
				pair,
				bets: bets.map((bet) => ({ ...bet })),
				progress: [...progress]
			};
		},

		restore(kept: Snapshot) {
			({ balance, serverSeed, clientSeed, nonce, pair } = kept);
			bets = kept.bets;
			progress.clear();
			for (const [key, value] of kept.progress) progress.set(key, value);
		}
	};
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;
