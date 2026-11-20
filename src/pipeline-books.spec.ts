/**
 * A game played from books, through the bet pipeline: that a bet is charged, a row drawn
 * and what it pays paid, that a round stops at a choice and plays on from the option
 * picked, that a bought bonus costs what its mode says, that counters are kept for each
 * size of bet and followed from bet to bet, and that every bet checks out from its seeds
 * as a player's browser would check it.
 *
 * This is where the rules of playing from books are held together. A site keeps a bet's
 * things somewhere of its own (a `BetStore`), and has only that to prove.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkGameFolder, openBooks, type Book } from "./book-files.ts";
import {
	bookGame,
	brokenHolds,
	verifyBookBet,
	type BookGame,
	type BookListing,
	type BookProgressView,
	type BookResult,
	type BookView
} from "./book-game.ts";
import { BOOK_RTP_BP } from "./game-manifest.ts";
import { createMemoryStore, type KeptBet, type MemoryStore } from "./memory.ts";
import {
	BetRejectedError,
	RoundProblem,
	createPipeline,
	type RoundResult
} from "./pipeline.ts";
import { inProcess } from "./play.ts";
import { proofsOf } from "./proofs.ts";
import { FIXTURE, writeBookFixture } from "./test/book-fixture.ts";

const PLAYER = "player";
const folder = mkdtempSync(join(tmpdir(), "keros3ne-pipeline-books-"));

let books: Record<string, Book>;
let listing: BookListing;
let game: BookGame;
let pipeline: ReturnType<typeof createPipeline<BookGame>>;
let memory: MemoryStore;

beforeAll(() => {
	writeBookFixture(folder);

	const checked = checkGameFolder(folder);
	expect(checked.check.problems).toEqual([]);

	books = openBooks(join(folder, "books"));
	listing = {
		game: checked.game,
		tables: checked.books.tables,
		modes: checked.check.modes
	};
	game = bookGame(listing, "studio", () => books);

	const maths = inProcess(game);
	pipeline = createPipeline<BookGame>({
		find: (slug) => (slug === FIXTURE ? game : undefined),
		maths: () => maths
	});
});

afterAll(() => {
	for (const book of Object.values(books)) book.close();
	rmSync(folder, { recursive: true, force: true });
});

beforeEach(() => {
	memory = createMemoryStore({ balance: 50_000_00 });
});

const view = (round: RoundResult<never>) => round.view as BookView;
const spin = (stake = 1_00, mode?: string) =>
	pipeline.openRound(memory.store, {
		userId: PLAYER,
		game: FIXTURE,
		stake,
		params: mode ? { mode } : {}
	});
const choose = (option: string) =>
	pipeline.actInRound(memory.store, {
		userId: PLAYER,
		game: FIXTURE,
		action: { choose: option }
	});
const resultOf = (bet: KeptBet) => bet.settled!.result as BookResult;

/** Plays a whole round, picking by `pick` if it stops at a choice. */
async function play(
	stake = 1_00,
	pick: (options: string[]) => string = (options) => options[0]
) {
	let round = await spin(stake);

	while (round.open) round = await choose(pick(view(round).options!));

	return round;
}

/** Spins until a round stops at its choice, and hands that round over, still open. */
async function spinToChoice(stake = 1_00) {
	for (let spins = 0; spins < 2_000; spins++) {
		const round = await spin(stake);
		if (round.open) return round;
	}

	throw new Error("No bonus in two thousand spins.");
}

/** A player's settled bets as a history lists them, newest first. */
const history = () =>
	memory.settledBets().map((bet) => ({
		id: bet.id,
		baseStake: bet.baseStake,
		state: bet.state,
		result: bet.settled!.result
	}));

describe("a game played from books, through the pipeline", () => {
	it("is one whose every mode returns what a game must", () => {
		expect(listing.modes.map((mode) => mode.id)).toEqual(["spin", "bonus"]);
		for (const mode of listing.modes) expect(mode.rtpBp).toBe(BOOK_RTP_BP);
	});

	it("takes the bet, draws a row and pays what the row pays", async () => {
		const before = memory.balance;
		let paid = 0;

		for (let spins = 0; spins < 60; spins++) {
			const round = await play();
			const result = resultOf(memory.settledBets()[0]);

			expect(result.steps[0].table).toBe("spin");
			expect(result.payoutBp).toBe(
				result.steps.reduce((total, step) => total + step.payoutBp, 0)
			);
			// One of the two whole cents either side of the bet times what the rows pay.
			expect(
				Math.abs(round.payout - (1_00 * result.payoutBp) / 10_000)
			).toBeLessThan(1);

			paid += round.payout;
		}

		expect(memory.settledBets()).toHaveLength(60);
		expect(memory.balance).toBe(before - 60 * 1_00 + paid);
	});

	it("shows the client the events of every row drawn, and keeps only which rows", async () => {
		const round = await play();
		const kept = memory.settledBets()[0];

		expect(view(round).steps.every((step) => Array.isArray(step.events))).toBe(true);
		expect(JSON.stringify(kept.settled!.result)).not.toContain("events");
		expect(kept.state).toMatchObject({ mode: "spin", choices: expect.any(Array) });
	});

	it("refuses a mode the game does not have, and takes nothing", async () => {
		const before = memory.balance;

		await expect(spin(1_00, "ante")).rejects.toThrow(BetRejectedError);
		expect(memory.balance).toBe(before);
	});
});

describe("a round that stops at a choice", () => {
	it("stays open, and is the same round when it is picked up again", async () => {
		const round = await spinToChoice();

		expect(view(round).options).toEqual(["steady", "wild"]);
		expect(round.payout).toBe(0);

		const again = await pipeline.currentRound(memory.store, PLAYER, FIXTURE);
		expect(again?.open).toBe(true);
		expect(again?.view).toEqual(round.view);
	});

	it("plays on from the option picked, and settles with everything paid", async () => {
		const open = await spinToChoice();
		const settled = await choose("wild");

		expect(settled.open).toBe(false);
		expect(view(settled).steps.map((step) => step.table)).toEqual([
			"spin",
			"bonus-wild"
		]);
		expect(view(settled).steps[0]).toMatchObject({
			row: view(open).steps[0].row,
			chosen: "wild"
		});
		expect(await pipeline.currentRound(memory.store, PLAYER, FIXTURE)).toBeNull();
	});

	it("refuses a choice that is not on offer, and leaves the round as it was", async () => {
		await spinToChoice();

		await expect(choose("hail")).rejects.toThrow(RoundProblem);
		expect((await pipeline.currentRound(memory.store, PLAYER, FIXTURE))?.open).toBe(
			true
		);
	});

	it("is opened at once by a bonus bought, for what the bonus costs", async () => {
		const before = memory.balance;
		const round = await spin(2_00, "bonus");

		expect(round.open).toBe(true);
		expect(round.stake).toBe(25 * 2_00);
		expect(round.baseStake).toBe(2_00);
		expect(memory.balance).toBe(before - 25 * 2_00);
		expect(view(round).steps[0].table).toBe("bought");
	});
});

describe("counters", () => {
	it("are kept from one bet to the next, apart for each size of bet", async () => {
		let pours = 0;

		// Played on until the meter has poured, so that it never rests on luck.
		for (let spins = 0; spins < 400 || (pours === 0 && spins < 20_000); spins++) {
			await play(1_00);
			pours += resultOf(memory.settledBets()[0]).steps.filter(
				(step) => step.filled
			).length;
		}
		expect(pours).toBeGreaterThan(0);

		const last = resultOf(memory.settledBets()[0]);
		expect(await pipeline.progressView(memory.store, PLAYER, FIXTURE, 1_00)).toEqual({
			held: last.counters!,
			full: { gem: 10 }
		} satisfies BookProgressView);

		// Nothing is held at a bet that has never been placed.
		expect(await pipeline.progressView(memory.store, PLAYER, FIXTURE, 2_00)).toEqual({
			held: { gem: 0 },
			full: { gem: 10 }
		});
	});

	it("are, in a history, what the bet before left at that size of bet", async () => {
		// Two sizes of bet, turn about, so that each size's counters run through the other's,
		// and on until a gem has dropped, or there would be nothing to follow.
		let played = 0;
		let gems = false;

		for (; played < 120 || (!gems && played < 20_000); played++) {
			const round = await play(played % 3 === 0 ? 2_00 : 1_00);

			gems ||= view(round).steps.some((step) => (step.adds?.gem ?? 0) > 0);
		}

		expect(history()).toHaveLength(played);
		expect(brokenHolds(listing, history())).toEqual([]);
	});

	it("show a bet said to have held other than the bet before left", async () => {
		for (let spins = 0; spins < 40; spins++) await play(1_00);

		const rows = history();
		const held = (row: (typeof rows)[number]) =>
			(row.state as { held: { gem: number } }).held.gem;

		// A bet in the middle recorded as holding one gem fewer: a meter set back.
		const lied = rows.map((row, index) =>
			index === 10
				? {
						...row,
						state: {
							...(row.state as object),
							held: { gem: (held(row) + 9) % 10 }
						}
					}
				: row
		);
		expect(brokenHolds(listing, lied)).toEqual([rows[10].id]);

		// A bet recorded as leaving other than it did breaks the bet after it.
		const left = rows.map((row, index) =>
			index === 10
				? {
						...row,
						result: {
							...(row.result as object),
							counters: {
								gem: ((row.result as BookResult).counters!.gem + 1) % 10
							}
						}
					}
				: row
		);
		expect(brokenHolds(listing, left)).toEqual([rows[9].id]);
	});
});

describe("a bet checked from its seeds", () => {
	it("checks out for every bet, as a player's browser checks it", async () => {
		let choices = 0;
		let played = 0;

		// Played on until a bonus has landed and its choice been taken.
		for (; played < 150 || (choices === 0 && played < 20_000); played++) {
			const round = await play(1_00, (options) => options[played % options.length]);

			choices += view(round).steps.filter((step) => step.chosen).length;
		}
		expect(choices).toBeGreaterThan(0);

		// The seeds are given up, as a player asks for new ones.
		const { clientSeed } = memory.fairness;
		const serverSeed = memory.rotateSeeds()!;
		const bets = memory.settledBets();
		expect(bets).toHaveLength(played);

		const toVerify = (bet: KeptBet) => ({
			state: bet.state,
			result: bet.settled!.result,
			baseStake: bet.baseStake,
			payout: bet.settled!.payout,
			nonce: bet.nonce,
			clientSeed,
			serverSeed
		});

		const byNonce = new Map(bets.map((bet) => [bet.nonce, bet]));
		let told = 0;

		for (const bet of bets) {
			const proofs = proofsOf(books, bet.settled!.result);
			const check = (change: object = {}) =>
				verifyBookBet(listing, { ...toVerify(bet), ...change }, proofs);

			expect(check()).toBe(true);
			// A bet said to have paid a cent more does not check out.
			expect(check({ payout: bet.settled!.payout + 1 })).toBe(false);

			// Nor one said to be the bet after it, wherever that bet drew another row: the
			// two are on the same seeds, so the next bet's first row is what this one would
			// have drawn in its place.
			const next = byNonce.get(bet.nonce + 1);
			if (next && resultOf(next).steps[0].row !== resultOf(bet).steps[0].row) {
				expect(check({ nonce: bet.nonce + 1 })).toBe(false);
				told += 1;
			}
		}
		// The table is small, so many bets draw the row their neighbour drew: not all.
		expect(told).toBeGreaterThan(0);

		// Nor does a bet recorded as holding other gems than were held.
		const bet = bets[0];
		const { held } = bet.state as { held: { gem: number } };
		expect(
			verifyBookBet(
				listing,
				{
					...toVerify(bet),
					state: {
						...(bet.state as object),
						held: { gem: (held.gem + 1) % 10 }
					}
				},
				proofsOf(books, bet.settled!.result)
			)
		).toBe(false);
	});
});
