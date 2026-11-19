/**
 * The questions a site's bet pipeline puts to a round game (./play.ts), answered from the
 * game itself: a site's own round games, and a studio's game as its books present it.
 * Pure: nothing here reads a database or the clock.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import * as v from "valibot";
import { createRng, type Rng } from "./rng.ts";
import { BP, type RoundGame } from "./maths.ts";

type AnyRound = RoundGame<unknown, unknown, unknown, unknown, unknown>;

export interface Seeds {
	serverSeed: string;
	clientSeed: string;
	nonce: number;
}

export interface Concluded {
	/** `null` while the round is still being played. */
	outcome: { payoutBp: number; result: unknown } | null;
	view: unknown;
	/** The player's progress after the round, if it settled and the game keeps any. */
	progress?: unknown;
	/** What the player may see of their progress now, or `null` for a game that keeps none. */
	progressView: unknown;
}

const rngOf = (seeds: Seeds): Rng =>
	createRng(seeds.serverSeed, seeds.clientSeed, seeds.nonce);

export function answer(game: AnyRound) {
	return {
		/**
		 * The options to open a round with, checked, what a round opened so costs (in bets, as
		 * basis points), and the most it may pay (of the bet).
		 */
		check(
			params: unknown
		): { params: unknown; costBp: number; maxMultiplierBp: number } | null {
			const parsed = v.safeParse(game.params, params);
			return parsed.success
				? {
						params: parsed.output,
						costBp: game.costBp?.(parsed.output) ?? BP,
						maxMultiplierBp: game.maxMultiplierBp(parsed.output)
					}
				: null;
		},
		initialProgress: (): unknown => game.progress?.initial(),
		start: (params: unknown, seeds: Seeds, progress: unknown): unknown =>
			game.start(params, rngOf(seeds), progress),
		/** An action, checked and applied. A move that is not valid is a problem, as one the game refuses. */
		act(
			state: unknown,
			action: unknown,
			seeds: Seeds
		): { state: unknown; extraStakes?: number } | { problem: string } {
			const parsed = v.safeParse(game.action, action);
			if (!parsed.success) return { problem: "That move is not valid." };
			return game.act(state, parsed.output, rngOf(seeds));
		},
		/** Whether the round is over, and what the player sees; `progress` is theirs before it. */
		conclude(state: unknown, seeds: Seeds, progress: unknown): Concluded {
			const outcome = game.outcome(state, rngOf(seeds));
			const view = game.view(state, rngOf(seeds));
			if (!game.progress) return { outcome, view, progressView: null };
			const next = outcome
				? game.progress.advance(progress, outcome.result)
				: undefined;
			return {
				outcome,
				view,
				...(outcome && { progress: next }),
				progressView: game.progress.view(outcome ? next : progress)
			};
		},
		view: (state: unknown, seeds: Seeds): unknown => game.view(state, rngOf(seeds)),
		progressView: (progress: unknown): unknown =>
			game.progress ? game.progress.view(progress) : null
	};
}
export type Answers = ReturnType<typeof answer>;
