/**
 * The bet pipeline on a store in memory: a game settled in one step, and what a store is
 * told. Rounds are held by the stand-in's tests (./stand-in.spec.ts), which play through
 * the same pipeline.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { settlePayout } from "./bets.ts";
import { createMemoryStore } from "./memory.ts";
import {
	BetRejectedError,
	InsufficientFundsError,
	createPipeline,
	type InstantPlay,
	type SettledBet
} from "./pipeline.ts";
import { createRng, payoutRoll } from "./rng.ts";

/** Heads or tails for a little under double: the plainest game settled in one step. */
const flip: InstantPlay = {
	kind: "instant",
	slug: "flip",
	params: v.object({ pick: v.picklist(["heads", "tails"]) }),
	play(params, rng) {
		const landed = rng.int(2) === 0 ? "heads" : "tails";
		const { pick } = params as { pick: string };

		return { result: { landed }, multiplierBp: landed === pick ? 19_800 : 0 };
	}
};

const pipeline = createPipeline<InstantPlay>({
	find: (slug) => (slug === flip.slug ? flip : undefined),
	maths: () => {
		throw new Error("an instant game has no round maths");
	}
});
const bet = (stake: number, params: unknown = { pick: "heads" }) => ({
	userId: "player",
	game: "flip",
	stake,
	params
});

describe("the bet pipeline", () => {
	it("charges a bet, draws it from the seeds, settles it and puts it on record", async () => {
		const memory = createMemoryStore({ balance: 10_00 });
		const placed = await pipeline.placeInstant(memory.store, bet(1_00));

		expect(placed).toMatchObject({ game: "flip", stake: 1_00, nonce: 1 });
		expect([0, 1_98]).toContain(placed.payout);
		expect(placed.balance).toBe(10_00 - 1_00 + placed.payout);
		expect(memory.balance).toBe(placed.balance);
		expect(memory.settledBets()).toHaveLength(1);

		// And it is what the seeds, once given up, say it was.
		const { clientSeed } = memory.fairness;
		const serverSeed = memory.rotateSeeds()!;
		const again = flip.play({ pick: "heads" }, createRng(serverSeed, clientSeed, 1));
		expect(again.result).toEqual(placed.result);
		expect(placed.payout).toBe(
			settlePayout(1_00, again.multiplierBp, payoutRoll(serverSeed, clientSeed, 1))
		);
	});

	it("refuses a bet that is not valid before anything is taken", async () => {
		const memory = createMemoryStore({ balance: 10_00 });
		const refused = (stake: number, params?: unknown, game = "flip") =>
			pipeline.placeInstant(memory.store, { ...bet(stake, params), game });

		await expect(refused(0)).rejects.toThrow(/smallest bet/);
		await expect(refused(1_000_00)).rejects.toThrow(/largest bet/);
		await expect(refused(1_00, { pick: "edge" })).rejects.toThrow(
			/options are not valid/
		);
		await expect(refused(1_00, undefined, "nothing")).rejects.toThrow(
			BetRejectedError
		);
		expect(memory.balance).toBe(10_00);
		expect(memory.fairness.nonce).toBe(0);
	});

	it("throws a balance that is short on through, for whoever keeps it to answer", async () => {
		const memory = createMemoryStore({ balance: 50 });

		await expect(pipeline.placeInstant(memory.store, bet(1_00))).rejects.toThrow(
			InsufficientFundsError
		);
	});

	it("tells the store of every settled bet, and hands back what the store gave for it", async () => {
		const memory = createMemoryStore({ balance: 10_00 });
		const told: SettledBet<InstantPlay>[] = [];
		const rewarding = createPipeline<InstantPlay, string>({
			find: () => flip,
			maths: () => {
				throw new Error("an instant game has no round maths");
			}
		});

		const placed = await rewarding.placeInstant(
			{
				...memory.store,
				settled: async (settled) => {
					told.push(settled);

					return "a pack";
				}
			},
			bet(2_00)
		);

		expect(placed.extra).toBe("a pack");
		expect(told).toHaveLength(1);
		expect(told[0]).toMatchObject({
			id: placed.id,
			userId: "player",
			stake: 2_00,
			multiplierBp: placed.multiplierBp
		});
	});
});
