/**
 * A small game played from books, written row by row for the engine's own tests: no maths
 * plays it and nothing weighs it, so its figures are chosen to come to exactly what a game
 * must. It has one of everything a game played from books can have: a spin, a bonus that
 * can be bought, a choice between two bonuses worth the same, and a counter that fills
 * over many spins.
 *
 * What each table is worth, in basis points of a bet:
 *
 * - `spin`, a thousand by weight: 689 lose; 251 pay (200 at 1x, 40 at 3x, 11 at 2.2x);
 *   30 pay half a bet and drop a gem or two, each gem counted at 200; 30 land the bonus,
 *   worth twenty bets. That is 9,600,000 over 1,000: 96.00%.
 * - `bought`, the bonus bought for 25 bets: three or five bets and then the bonus, 24 bets
 *   in all, which is 96.00% of what it costs.
 * - `bonus-steady` and `bonus-wild`: twenty bets each, one evenly and one rarely.
 * - `gem-pour`, drawn when ten gems are held: 2,000, what ten gems were counted at.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBookWriter, writeBooksSummary, type NewRow } from "../book-files.ts";
import type { BookSummary } from "../book.ts";

/** The game's slug. */
export const FIXTURE = "book-fixture";

/** The two ways its bonus is taken. */
const BONUS = [
	{ id: "steady", table: "bonus-steady" },
	{ id: "wild", table: "bonus-wild" }
];

/** The game's manifest. */
const MANIFEST = {
	slug: FIXTURE,
	name: "Book Fixture",
	blurb: "A small game for the engine's own tests of books.",
	version: "1.0.0",
	category: "slots",
	modes: [
		{ id: "spin", name: "Spin", costBp: 10_000, table: "spin" },
		{ id: "bonus", name: "Bought bonus", costBp: 250_000, table: "bought" }
	],
	counters: [{ id: "gem", full: 10, worthBp: 200, table: "gem-pour" }]
};

/** Every table's rows. */
const TABLES: Record<string, NewRow[]> = {
	spin: [
		{ weight: 689, payoutBp: 0, events: [{ type: "reveal", win: 0 }] },
		{ weight: 200, payoutBp: 10_000, events: [{ type: "reveal", win: 10_000 }] },
		{ weight: 40, payoutBp: 30_000, events: [{ type: "reveal", win: 30_000 }] },
		{ weight: 11, payoutBp: 22_000, events: [{ type: "reveal", win: 22_000 }] },
		{
			weight: 20,
			payoutBp: 5_000,
			events: [
				{ type: "reveal", win: 5_000 },
				{ type: "gems", gems: 1 }
			],
			adds: { gem: 1 }
		},
		{
			weight: 10,
			payoutBp: 5_000,
			events: [
				{ type: "reveal", win: 5_000 },
				{ type: "gems", gems: 2 }
			],
			adds: { gem: 2 }
		},
		{ weight: 30, payoutBp: 0, events: [{ type: "bonus" }], choice: BONUS }
	],
	bought: [
		{ weight: 1, payoutBp: 30_000, events: [{ type: "bought" }], choice: BONUS },
		{ weight: 1, payoutBp: 50_000, events: [{ type: "bought" }], choice: BONUS }
	],
	"bonus-steady": [
		{ weight: 1, payoutBp: 150_000, events: [{ type: "freeSpins", win: 150_000 }] },
		{ weight: 1, payoutBp: 250_000, events: [{ type: "freeSpins", win: 250_000 }] }
	],
	"bonus-wild": [
		{ weight: 3, payoutBp: 0, events: [{ type: "freeSpins", win: 0 }] },
		{ weight: 1, payoutBp: 800_000, events: [{ type: "freeSpins", win: 800_000 }] }
	],
	"gem-pour": [
		{ weight: 1, payoutBp: 1_000, events: [{ type: "pour", win: 1_000 }] },
		{ weight: 1, payoutBp: 3_000, events: [{ type: "pour", win: 3_000 }] }
	]
};

/** How a fixture differs from the game as first written: another version of it. */
export interface FixtureVersion {
	/** What its manifest says otherwise: its version, its counters, how it converts them. */
	manifest?: Record<string, unknown>;
	/** What a row that drops gems drops, as a multiple of what the first version's does. */
	gems?: number;
	/** The folder its books go in, beside `game.json`: `books`, or `maths` as a package has them. */
	books?: string;
}

/** Writes the game into a folder: its `game.json`, and its books beside it in `books/`. */
export function writeBookFixture(folder: string, version: FixtureVersion = {}): void {
	const books = join(folder, version.books ?? "books");
	const gems = version.gems ?? 1;

	mkdirSync(books, { recursive: true });
	writeFileSync(
		join(folder, "game.json"),
		JSON.stringify({ ...MANIFEST, ...version.manifest })
	);

	const summaries: Record<string, BookSummary> = {};
	for (const [table, rows] of Object.entries(TABLES)) {
		const writer = createBookWriter(books, table);

		for (const row of rows)
			writer.add(
				row.adds
					? {
							...row,
							adds: Object.fromEntries(
								Object.entries(row.adds).map(([id, units]) => [
									id,
									units * gems
								])
							)
						}
					: row
			);
		summaries[table] = writer.close();
	}

	writeBooksSummary(books, summaries);
}

/** The files of the fixture as a package holds them, by their places. */
export const PACKAGE_FILES = [
	"game.json",
	"guide.json",
	"card.svg",
	"client/index.html",
	"client/_app/game.js",
	"maths/books.json",
	...Object.keys(TABLES).flatMap((table) => [
		`maths/${table}.index`,
		`maths/${table}.rows`
	])
];

/**
 * Writes the game into a folder as a package lays it out: its manifest, a guide, a card,
 * a client of two files, and its books in `maths/`.
 */
export function writePackageFixture(folder: string, version: FixtureVersion = {}): void {
	writeBookFixture(folder, { ...version, books: "maths" });

	mkdirSync(join(folder, "client", "_app"), { recursive: true });
	writeFileSync(
		join(folder, "guide.json"),
		JSON.stringify({ rules: [{ type: "text", text: "Spin, and gems may drop." }] })
	);
	writeFileSync(join(folder, "card.svg"), "<svg xmlns='http://www.w3.org/2000/svg' />");
	writeFileSync(join(folder, "client", "index.html"), "<!doctype html><p>the game</p>");
	writeFileSync(join(folder, "client", "_app", "game.js"), "export const game = 1;");
}
