/**
 * Counters carried from one version of a game to the next (./counter-conversion.ts): what
 * an update must show before a site takes it, and what a player then holds.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { describe, expect, it } from "vitest";
import { checkUpdate, convertCounters, convertThrough } from "./counter-conversion.ts";
import { checkGameManifest, type GameManifest } from "./game-manifest.ts";

/** A game with counters, at a version, with whatever else is said of it. */
const game = (version: string, more: Record<string, unknown> = {}): GameManifest =>
	checkGameManifest("a game", {
		slug: "crucibles",
		version,
		name: "Crucibles",
		blurb: "A game that keeps meters.",
		category: "slots",
		minStake: 20,
		maxStake: 1000,
		steps: [{ under: 200, by: 20 }, { by: 100 }],
		modes: [{ id: "spin", name: "Spin", costBp: 10_000, table: "spin" }],
		counters: [
			{ id: "bronze", full: 50, worthBp: 2000, table: "pour-bronze" },
			{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
		],
		...more
	});

const first = game("1.0.0");

describe("an update to a game with counters", () => {
	it("is taken as it is where the counters did not change: what is held is held", () => {
		const next = game("1.0.1", { blurb: "The same meters." });

		expect(checkUpdate(first, next)).toEqual({ problems: [], excessBp: 0 });
		expect(convertCounters(next, { bronze: 49, gold: 3 })).toEqual({
			bronze: 49,
			gold: 3
		});
	});

	it("must come after the version it follows", () => {
		expect(checkUpdate(first, game("1.0.0")).problems).toEqual([
			expect.stringMatching(/does not come after 1\.0\.0/)
		]);
		expect(checkUpdate(game("1.10.0"), game("1.9.0")).problems).toEqual([
			expect.stringMatching(/1\.9\.0, does not come after 1\.10\.0/)
		]);
	});

	it("must say how changed counters are converted, each into one of its own", () => {
		const changed = {
			counters: [
				{ id: "bronze", full: 60, worthBp: 2000, table: "pour-bronze" },
				{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
			]
		};

		expect(checkUpdate(first, game("1.1.0", changed)).problems).toEqual([
			expect.stringMatching(/does not say how to convert them/)
		]);
		expect(
			checkUpdate(
				first,
				game("1.1.0", {
					...changed,
					converts: {
						from: "1.0.0",
						counters: { bronze: { to: "bronze", times: 1, over: 1 } }
					}
				})
			).problems
		).toEqual([expect.stringMatching(/what becomes of the counter "gold"/)]);
		expect(
			checkUpdate(
				first,
				game("1.1.0", {
					...changed,
					converts: {
						from: "0.9.0",
						counters: {
							bronze: { to: "bronze", times: 1, over: 1 },
							gold: { to: "gold", times: 1, over: 1 }
						}
					}
				})
			).problems
		).toEqual([
			expect.stringMatching(/from 0\.9\.0, and the version before it is 1\.0\.0/)
		]);
	});

	it("leaves nobody with less than they held, and says the most rounding up gives away", () => {
		// Bronze is worth less a unit and takes more to fill: eleven new units for ten old.
		const next = game("1.1.0", {
			counters: [
				{ id: "bronze", full: 60, worthBp: 1850, table: "pour-bronze" },
				{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
			],
			converts: {
				from: "1.0.0",
				counters: {
					bronze: { to: "bronze", times: 11, over: 10 },
					gold: { to: "gold", times: 1, over: 1 }
				}
			}
		});
		const check = checkUpdate(first, next);

		expect(check.problems).toEqual([]);
		// At worst 41 old units, worth 82,000, become 46 new, worth 85,100.
		expect(check.excessBp).toBe(3100);
		expect(convertCounters(next, { bronze: 49, gold: 9 })).toEqual({
			bronze: 54,
			gold: 9
		});
		expect(convertCounters(next, { bronze: 1 })).toEqual({ bronze: 2, gold: 0 });
		expect(convertCounters(next, {})).toEqual({ bronze: 0, gold: 0 });

		// Unit for unit into a counter worth less is a loss, and is refused.
		const short = game("1.1.0", {
			counters: [
				{ id: "bronze", full: 60, worthBp: 1850, table: "pour-bronze" },
				{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
			],
			converts: {
				from: "1.0.0",
				counters: {
					bronze: { to: "bronze", times: 1, over: 1 },
					gold: { to: "gold", times: 1, over: 1 }
				}
			}
		});
		expect(checkUpdate(first, short).problems).toEqual([
			expect.stringMatching(
				/1 of "bronze", worth 2000 .* would become 1 of "bronze", worth 1850/
			)
		]);
	});

	it("fills no counter, and takes none away", () => {
		const full = game("1.1.0", {
			counters: [
				{ id: "bronze", full: 40, worthBp: 2500, table: "pour-bronze" },
				{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
			],
			converts: {
				from: "1.0.0",
				counters: {
					bronze: { to: "bronze", times: 1, over: 1 },
					gold: { to: "gold", times: 1, over: 1 }
				}
			}
		});
		expect(checkUpdate(first, full).problems).toEqual([
			expect.stringMatching(
				/40 of "bronze" would become 40 of "bronze", which is full at 40/
			)
		]);

		const { counters: _none, ...without } = first;
		expect(
			checkUpdate(
				first,
				checkGameManifest("a game", { ...without, version: "1.1.0" })
			).problems
		).toEqual([expect.stringMatching(/has no counters, and 1\.0\.0 had/)]);
	});

	it("may rename a counter and add one, which starts from nothing", () => {
		const next = game("2.0.0", {
			counters: [
				{ id: "copper", full: 50, worthBp: 2000, table: "pour-bronze" },
				{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" },
				{ id: "iron", full: 5, worthBp: 100, table: "pour-gold" }
			],
			converts: {
				from: "1.0.0",
				counters: {
					bronze: { to: "copper", times: 1, over: 1 },
					gold: { to: "gold", times: 1, over: 1 }
				}
			}
		});

		expect(checkUpdate(first, next)).toEqual({ problems: [], excessBp: 0 });
		expect(convertCounters(next, { bronze: 7, gold: 2 })).toEqual({
			copper: 7,
			gold: 2,
			iron: 0
		});
	});

	it("keeps every size of bet a player may hold counters at", () => {
		expect(checkUpdate(first, game("1.0.1", { minStake: 40 })).problems).toEqual([
			expect.stringMatching(/no longer offers a bet that 1\.0\.0 did \(0\.20\)/)
		]);
		// More sizes are no loss.
		expect(checkUpdate(first, game("1.0.1", { maxStake: 2000 })).problems).toEqual(
			[]
		);
	});

	it("needs none of this for a game that had no counters", () => {
		const { counters: _none, ...plain } = first;
		const before = checkGameManifest("a game", plain);

		expect(checkUpdate(before, game("1.1.0"))).toEqual({ problems: [], excessBp: 0 });
		expect(
			checkUpdate(
				before,
				checkGameManifest("a game", { ...plain, version: "1.1.0", minStake: 100 })
			).problems
		).toEqual([]);
	});
});

describe("what a player holds after several versions", () => {
	const second = game("1.1.0", {
		counters: [
			{ id: "bronze", full: 100, worthBp: 1000, table: "pour-bronze" },
			{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
		],
		converts: {
			from: "1.0.0",
			counters: {
				bronze: { to: "bronze", times: 2, over: 1 },
				gold: { to: "gold", times: 1, over: 1 }
			}
		}
	});
	const third = game("1.2.0", { counters: second.counters, blurb: "Nothing new." });
	const fourth = game("1.3.0", {
		counters: [
			{ id: "copper", full: 100, worthBp: 1000, table: "pour-bronze" },
			{ id: "gold", full: 10, worthBp: 9000, table: "pour-gold" }
		],
		converts: {
			from: "1.2.0",
			counters: {
				bronze: { to: "copper", times: 1, over: 1 },
				gold: { to: "gold", times: 1, over: 1 }
			}
		}
	});
	const versions = [first, second, third, fourth];

	it("is each conversion in turn, from the version they last played", () => {
		expect(convertThrough(versions, "1.0.0", { bronze: 20, gold: 4 })).toEqual({
			copper: 40,
			gold: 4
		});
		expect(convertThrough(versions, "1.2.0", { bronze: 20, gold: 4 })).toEqual({
			copper: 20,
			gold: 4
		});
		expect(convertThrough(versions, "1.3.0", { copper: 5, gold: 1 })).toEqual({
			copper: 5,
			gold: 1
		});
	});

	it("is what was kept, for a version the site does not know", () => {
		expect(convertThrough(versions, undefined, { copper: 5 })).toEqual({ copper: 5 });
		expect(convertThrough(versions, "0.1.0", { copper: 5 })).toEqual({ copper: 5 });
	});
});
