/**
 * A game a site holds two versions of, through the pipeline: that a bet records the
 * version it was played on, that a page opened before an update starts nothing new, that
 * a round opened before it is finished on the version it was opened on, and that what a
 * player held in the old version's counters is carried into the new one's.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkGameFolder } from "./book-files.ts";
import {
	brokenHolds,
	type BookProgressView,
	type BookResult,
	type BookState,
	type BookView
} from "./book-game.ts";
import { checkUpdate } from "./counter-conversion.ts";
import { listingOf } from "./game-package.ts";
import { listedEntry, type StudioRound } from "./listing.ts";
import { createMemoryStore, type MemoryStore } from "./memory.ts";
import {
	BetRejectedError,
	GameUpdatedError,
	createPipeline,
	type RoundResult
} from "./pipeline.ts";
import { createPlay } from "./play.ts";
import { PROTOCOL } from "./protocol.ts";
import { FIXTURE, writePackageFixture } from "./test/book-fixture.ts";

const PLAYER = "player";
const site = mkdtempSync(join(tmpdir(), "keros3ne-versions-"));

/** The second version: a gem counter twice as long, each gem worth half as much. */
const SECOND = {
	manifest: {
		version: "1.1.0",
		counters: [{ id: "gem", full: 20, worthBp: 100, table: "gem-pour" }],
		converts: { from: "1.0.0", counters: { gem: { to: "gem", times: 2, over: 1 } } }
	},
	gems: 2
};

let first: StudioRound;
let second: StudioRound;
/** The version the site plays now. */
let current: StudioRound;
let play: ReturnType<typeof createPlay>;
let pipeline: ReturnType<typeof createPipeline<StudioRound>>;
let memory: MemoryStore;

/** A version of the fixture as a site holds it once installed. */
function installed(version: string, how = {}): StudioRound {
	const folder = join(site, version);
	writePackageFixture(folder, how);

	const checked = checkGameFolder(folder, join(folder, "maths"));
	expect(checked.check.problems).toEqual([]);

	return listedEntry(
		listingOf(
			{
				folder,
				checked,
				record: {
					format: 1,
					slug: FIXTURE,
					version,
					protocol: PROTOCOL,
					files: {}
				}
			},
			"studio"
		),
		"the test",
		"studio",
		FIXTURE
	);
}

beforeAll(() => {
	first = installed("1.0.0");
	second = installed("1.1.0", SECOND);

	play = createPlay(
		(game) => join(site, game.version, "maths"),
		() => [first.books.game, second.books.game]
	);
	pipeline = createPipeline<StudioRound>({
		find: (slug, version) =>
			slug !== FIXTURE
				? undefined
				: version === undefined
					? current
					: [first, second].find((each) => each.version === version),
		maths: (game) => play.roundMaths(game)
	});
});

afterAll(() => {
	play.close(first);
	play.close(second);
	rmSync(site, { recursive: true, force: true });
});

beforeEach(() => {
	memory = createMemoryStore({ balance: 50_000_00 });
	current = first;
});

const view = (round: RoundResult<never>) => round.view as BookView;
const spin = (version?: string, stake = 1_00) =>
	pipeline.openRound(memory.store, {
		userId: PLAYER,
		game: FIXTURE,
		stake,
		params: {},
		...(version !== undefined ? { version } : {})
	});
const choose = (option: string) =>
	pipeline.actInRound(memory.store, {
		userId: PLAYER,
		game: FIXTURE,
		action: { choose: option }
	});

/** Plays a whole round on the version the site plays now. */
async function round(stake = 1_00) {
	let played = await spin(current.version, stake);

	while (played.open) played = await choose(view(played).options![0]);

	return played;
}

/** What the player holds of the gem counter at a bet, as they see it. */
const held = async (stake = 1_00) =>
	(
		(await pipeline.progressView(
			memory.store,
			PLAYER,
			FIXTURE,
			stake
		)) as BookProgressView
	).held.gem;

/** A player's settled bets as a history lists them, newest first. */
const history = () =>
	memory.settledBets().map((bet) => ({
		id: bet.id,
		version: bet.version,
		baseStake: bet.baseStake,
		state: bet.state,
		result: bet.settled!.result
	}));

describe("a game updated on a site", () => {
	it("may follow the version before: nobody holds less in its counters", () => {
		// Two new gems at 100 for one old at 200: exactly what was held, with nothing given away.
		expect(checkUpdate(first.books.game, second.books.game)).toEqual({
			problems: [],
			excessBp: 0
		});
	});

	it("puts each bet on record with the version it was played on", async () => {
		await round();
		current = second;
		await round();

		expect(memory.settledBets().map((bet) => bet.version)).toEqual([
			"1.1.0",
			"1.0.0"
		]);
	});

	it("starts nothing new from a page opened before the update, and takes nothing for it", async () => {
		await spin("1.0.0").then(async (played) => {
			while (played.open) played = await choose(view(played).options![0]);
		});
		current = second;

		const before = memory.balance;
		const refused = await spin("1.0.0").catch((error: unknown) => error);

		expect(refused).toBeInstanceOf(GameUpdatedError);
		expect(refused).toBeInstanceOf(BetRejectedError);
		expect((refused as Error).message).toMatch(/new version of this game is ready/);
		expect(memory.balance).toBe(before);

		// Loaded again, the page has the version there is now.
		expect((await spin("1.1.0")).version).toBe("1.1.0");
	});

	it("finishes a round on the version it was opened on, and only then moves on", async () => {
		let open = await spin("1.0.0");
		for (let spins = 0; !open.open && spins < 2_000; spins++)
			open = await spin("1.0.0");
		expect(open.open).toBe(true);

		current = second;

		// Picked up again, it is still the first version's round.
		const picked = await pipeline.currentRound(memory.store, PLAYER, FIXTURE);
		expect(picked).toMatchObject({ id: open.id, open: true, version: "1.0.0" });
		expect(view(picked!).options).toEqual(view(open).options);

		// No new round while it is open, on either version.
		await expect(spin("1.1.0")).rejects.toThrow(/Finish the round/);

		const finished = await choose(view(open).options![0]);
		expect(finished).toMatchObject({ open: false, version: "1.0.0" });
		expect(memory.settledBets()[0].version).toBe("1.0.0");

		await expect(spin("1.0.0")).rejects.toBeInstanceOf(GameUpdatedError);
		expect((await spin("1.1.0")).version).toBe("1.1.0");
	});
});

describe("counters carried into a new version", () => {
	/** Plays the first version until the player holds some gems, and says how many. */
	async function someGems() {
		for (let spins = 0; spins < 20_000; spins++) {
			await round();
			if ((await held()) > 0) return held();
		}

		throw new Error("No gem in twenty thousand spins.");
	}

	it("are converted as the new version says, when the player next plays", async () => {
		const gems = await someGems();
		expect(gems).toBeLessThan(10);

		current = second;

		// Seen before a bet is placed, and held going into the next bet: two for one.
		expect(await held()).toBe(gems * 2);
		// At a size of bet they never played, nothing.
		expect(await held(2_00)).toBe(0);

		await round();
		const [after] = memory.settledBets();
		expect((after.state as BookState).held).toEqual({ gem: gems * 2 });
		expect(after.version).toBe("1.1.0");

		// Kept from then on as the new version's own: converted once, not again.
		const left = (after.settled!.result as BookResult).counters!.gem;
		expect(await held()).toBe(left);
	});

	it("follow, in a history, from the bet before across the update", async () => {
		await someGems();
		current = second;
		for (let spins = 0; spins < 60; spins++) await round();

		const versions = [first.books.game, second.books.game];
		expect(new Set(history().map((bet) => bet.version))).toEqual(
			new Set(["1.0.0", "1.1.0"])
		);
		expect(brokenHolds(second.books, history(), versions)).toEqual([]);

		// The first bet after the update said to have held what the old version left,
		// unconverted: a meter set back, and found.
		const rows = history();
		const at = rows.findLastIndex((bet) => bet.version === "1.1.0");
		const before = (rows[at + 1].result as BookResult).counters!.gem;
		const lied = rows.map((row, index) =>
			index === at
				? { ...row, state: { ...(row.state as object), held: { gem: before } } }
				: row
		);
		expect(brokenHolds(second.books, lied, versions)).toEqual([rows[at].id]);
	});
});
