/**
 * A game's manifest and the summary of its books: what is taken, what is refused and
 * why, and that books on disk are held to the summary beside them.
 *
 * Author: dwclake
 * Created: 2026-11-17
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	createBookWriter,
	openBooks,
	readBooksSummary,
	writeBooksSummary
} from "./book-files.ts";
import {
	checkGameManifest,
	fillsFor,
	missingTables,
	modeOf,
	releaseOf,
	releaseTag
} from "./game-manifest.ts";

const folder = mkdtempSync(join(tmpdir(), "keros3ne-game-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const game = {
	slug: "stormglass",
	name: "Stormglass",
	blurb: "Five reels under a sky you choose.",
	version: "1.0.0",
	category: "slots",
	modes: [
		{ id: "spin", name: "Spin", costBp: 10_000, table: "spin" },
		{ id: "bonus", name: "Bought bonus", costBp: 1_000_000, table: "bonus" }
	]
};

/** Writes a table of two rows and says what it came to. */
function table(name: string, payoutBp: number) {
	const writer = createBookWriter(folder, name);
	writer.add({ weight: 3, payoutBp: 0, events: [] });
	writer.add({ weight: 1, payoutBp, events: [{ type: "win" }] });

	return writer.close();
}

describe("a game's manifest", () => {
	it("is taken as written, the ordinary mode first", () => {
		const manifest = checkGameManifest("game.json", game);

		expect(manifest.modes[0].id).toBe("spin");
		expect(modeOf(manifest, "bonus")?.costBp).toBe(1_000_000);
		expect(modeOf(manifest, "ante")).toBeUndefined();
	});

	it("is refused with the place and the reason", () => {
		const refused = (change: object) => () =>
			checkGameManifest("game.json", { ...game, ...change });

		expect(refused({ slug: "Storm Glass" })).toThrow(/game\.json.*slug.*hyphens/);
		expect(refused({ modes: [] })).toThrow(/no way of being played/);
		expect(refused({ modes: [game.modes[0], game.modes[0]] })).toThrow(/same id/);
		expect(refused({ modes: [{ ...game.modes[0], costBp: 9_999 }] })).toThrow(
			/at least one bet/
		);
		expect(refused({ modes: [{ ...game.modes[0], costBp: 10_000_001 }] })).toThrow(
			/thousand bets/
		);
		expect(refused({ modes: [{ ...game.modes[0], costBp: 12_500 }] })).toThrow(
			/whole number of bets/
		);
		expect(refused({ minStake: 0 })).toThrow(/minStake/);
		expect(refused({ shapes: ["tall"] })).toThrow(/wide view/);
		expect(refused({ shapes: ["wide", "wide"] })).toThrow(/twice/);
		expect(refused({ minStake: 500, maxStake: 100 })).toThrow(/over the largest/);
		expect(refused({ rtpBp: 9_700 })).toThrow(/rtpBp/);
	});

	it("says its own version, and is released under a tag made of its slug and that", () => {
		expect(checkGameManifest("a game", game).version).toBe("1.0.0");

		const { version: _none, ...unversioned } = game;
		expect(() => checkGameManifest("a game", unversioned)).toThrow(/version/);
		for (const version of ["1.0", "v1.0.0", "1.0.0-beta", "01.0.0", ""])
			expect(() => checkGameManifest("a game", { ...game, version })).toThrow(
				/three numbers/
			);

		expect(releaseTag("stormglass", "1.4.0")).toBe("stormglass-v1.4.0");
		expect(releaseOf("stormglass-v1.4.0")).toEqual({
			slug: "stormglass",
			version: "1.4.0"
		});
		// A slug may itself hold "-v": the version is what follows the last.
		expect(releaseOf("the-vault-v2.0.10")).toEqual({
			slug: "the-vault",
			version: "2.0.10"
		});
		for (const tag of [
			"v1.4.0",
			"stormglass-1.4.0",
			"stormglass-v1.4",
			"Storm-v1.0.0"
		])
			expect(releaseOf(tag)).toBeNull();
	});

	it("may say what its bar moves the bet by, in bands from the smallest bets up", () => {
		const steps = [{ under: 2_00, by: 20 }, { under: 6_00, by: 25 }, { by: 50 }];
		expect(checkGameManifest("game.json", { ...game, steps }).steps).toEqual(steps);

		const refused = (bands: object[]) => () =>
			checkGameManifest("game.json", { ...game, steps: bands });
		expect(refused([])).toThrow(/steps/);
		expect(refused([{ under: 2_00, by: 20 }])).toThrow(/has no `under`/);
		expect(refused([{ by: 20 }, { by: 50 }])).toThrow(/higher than the band's/);
		expect(
			refused([{ under: 6_00, by: 20 }, { under: 2_00, by: 25 }, { by: 50 }])
		).toThrow(/higher than the band's/);
		expect(refused([{ by: 0 }])).toThrow(/steps/);
		expect(refused([{ by: 2.5 }])).toThrow(/whole number of cents/);
	});
});

describe("a summary of books", () => {
	const tables = { spin: table("spin", 38_400), bonus: table("bonus", 3_840_000) };

	it("is read back as it was written, its tables in order of name", () => {
		const written = writeBooksSummary(folder, tables);

		expect(readBooksSummary(folder)).toEqual(written);
		expect(Object.keys(written.tables)).toEqual(["bonus", "spin"]);
	});

	it("says which mode has no book", () => {
		const manifest = checkGameManifest("game.json", game);
		const summary = writeBooksSummary(folder, { spin: tables.spin });

		expect(missingTables(manifest, summary)).toEqual([
			'the mode "bonus" opens the table "bonus", which has no book'
		]);
		expect(missingTables(manifest, writeBooksSummary(folder, tables))).toEqual([]);
	});

	it("opens the books it describes, and refuses one made again differently", () => {
		writeBooksSummary(folder, tables);

		const books = openBooks(folder);
		expect(books.spin.digest).toBe(tables.spin.digest);
		for (const book of Object.values(books)) book.close();

		table("spin", 40_000);
		expect(() => openBooks(folder)).toThrow(
			/"spin" is not the one it was said to be/
		);
	});
});

describe("a game's counters", () => {
	const counters = [
		{ id: "bronze", full: 55, worthBp: 2_379, table: "pour-bronze" },
		{ id: "silver", full: 55, worthBp: 3_812, table: "pour-silver" },
		{ id: "gold", full: 45, worthBp: 2_821, table: "pour-gold" }
	];
	const fills = [{ counters: ["silver", "bronze"], table: "pour-both" }];

	it("are taken with the tables they fill from", () => {
		const manifest = checkGameManifest("game.json", { ...game, counters, fills });

		expect(manifest.counters).toEqual(counters);
		expect(manifest.fills).toEqual(fills);
	});

	it("are refused when they do not join up", () => {
		const refused = (change: object) => () =>
			checkGameManifest("game.json", { ...game, counters, ...change });

		expect(refused({ counters: [counters[0], counters[0]] })).toThrow(/same id/);
		expect(refused({ counters: [{ ...counters[0], full: 0 }] })).toThrow(/full/);
		expect(refused({ counters: [{ ...counters[0], worthBp: 0.5 }] })).toThrow(
			/worthBp/
		);
		expect(refused({ fills: [{ counters: ["bronze"], table: "pour" }] })).toThrow(
			/two counters or more/
		);
		expect(
			refused({ fills: [{ counters: ["bronze", "tin"], table: "pour" }] })
		).toThrow(/does not have/);
		expect(
			refused({
				fills: [...fills, { counters: ["bronze", "silver"], table: "other" }]
			})
		).toThrow(/same counters/);
	});

	it("fill from the table named for exactly those that filled, or each from its own", () => {
		const rules = checkGameManifest("game.json", { ...game, counters, fills });

		expect(fillsFor(rules, ["bronze", "silver"])).toEqual([
			{ table: "pour-both", counters: ["bronze", "silver"] }
		]);
		expect(fillsFor(rules, ["gold", "bronze"])).toEqual([
			{ table: "pour-bronze", counters: ["bronze"] },
			{ table: "pour-gold", counters: ["gold"] }
		]);
		expect(fillsFor(rules, ["silver", "gold", "bronze"])).toHaveLength(3);
		expect(fillsFor(rules, ["silver"])).toEqual([
			{ table: "pour-silver", counters: ["silver"] }
		]);
		expect(fillsFor(rules, [])).toEqual([]);
	});
});
