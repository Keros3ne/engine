/**
 * A bet's steps: the ladder they make, and whether a bet is on it.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import { describe, expect, it } from "vitest";
import { stakeOffered } from "./bets.ts";
import { onLadder, SITE_STEPS, stakeLadder, type StakeSteps } from "./stake-steps.ts";

const STEPS: StakeSteps = [
	{ under: 2_00, by: 20 },
	{ under: 6_00, by: 25 },
	{ under: 10_00, by: 50 },
	{ by: 10_00 }
];

describe("a bet's steps", () => {
	it("say a bet is on the ladder exactly when the ladder lists it", () => {
		for (const [limits, steps] of [
			[{ min: 20, max: 100_00 }, STEPS],
			[{ min: 1, max: 100_00 }, SITE_STEPS],
			// Limits that are on no step are bets all the same: the bar stops at them.
			[{ min: 15, max: 73_33 }, STEPS]
		] as const) {
			const ladder = new Set(stakeLadder(limits, steps));
			for (let cents = 0; cents <= limits.max + 5; cents++)
				expect(onLadder(cents, limits, steps), `${cents}`).toBe(
					ladder.has(cents)
				);
		}

		expect(onLadder(40.5, { min: 20, max: 100_00 }, STEPS)).toBe(false);
	});

	it("are a studio game's own where it names them, and the site's where it does not", () => {
		const game = { minStake: 20, steps: STEPS };
		expect(stakeOffered(game, 20)).toBe(true);
		expect(stakeOffered(game, 1_80)).toBe(true);
		expect(stakeOffered(game, 5_75)).toBe(true);
		// A step of the site's, not of the game's.
		expect(stakeOffered(game, 30)).toBe(false);
		expect(stakeOffered(game, 37)).toBe(false);
		expect(stakeOffered(game, 10)).toBe(false);
		expect(stakeOffered(game, 100_00)).toBe(true);
		expect(stakeOffered(game, 110_00)).toBe(false);

		expect(stakeOffered({}, 30)).toBe(true);
		expect(stakeOffered({}, 5_75)).toBe(false);
		expect(stakeOffered({}, 1)).toBe(true);
	});
});
