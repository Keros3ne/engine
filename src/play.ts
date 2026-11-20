/**
 * How a site's bet pipeline plays a round game: what answers its questions, and, for a
 * studio's game, the books it is played from.
 *
 * Every round game answers in the server's process: a site's own, and a studio's game,
 * which is played from books and has no code of its studio's to run. Every call is pure,
 * so a transaction run again may ask again.
 *
 * Books are data. Nothing here, or anywhere on a site, runs a studio's maths.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import { openBooks, type Book } from "./book-files.ts";
import { bookGame, type BookGame } from "./book-game.ts";
import { convertThrough } from "./counter-conversion.ts";
import type { GameManifest } from "./game-manifest.ts";
import type { RoundGame } from "./maths.ts";
import { answer, type Concluded, type Seeds } from "./answers.ts";
import { GameFailedError } from "./game-failed.ts";
import { isStudioRound, type StudioRound } from "./listing.ts";

export type { Concluded, Seeds };
export { GameFailedError };

type AnyRound = RoundGame<unknown, unknown, unknown, unknown, unknown>;

/** What the pipeline may ask of a round game. */
export interface RoundMaths {
	/** Whether the game keeps progress between bets. */
	readonly keepsProgress: boolean;
	/**
	 * The options to open a round with, checked, what a round opened so costs (a multiple of
	 * the bet, in basis points) and the most it may pay (of the bet).
	 */
	check(
		params: unknown
	): Promise<{ params: unknown; costBp: number; maxMultiplierBp: number } | null>;
	initialProgress(): Promise<unknown>;
	start(params: unknown, seeds: Seeds, progress: unknown): Promise<unknown>;
	/** An action, checked and applied. A move that is not valid is a problem, as one the game refuses. */
	act(
		state: unknown,
		action: unknown,
		seeds: Seeds
	): Promise<{ state: unknown; extraStakes?: number } | { problem: string }>;
	/** Whether the round is over, and what the player sees; `progress` is theirs before it. */
	conclude(state: unknown, seeds: Seeds, progress: unknown): Promise<Concluded>;
	view(state: unknown, seeds: Seeds): Promise<unknown>;
	progressView(progress: unknown): Promise<unknown>;
	/**
	 * What was kept for a player at an earlier version of the game, `from`, carried into
	 * this one's. Only a game that has versions and keeps progress says.
	 */
	carry?(progress: unknown, from: string | undefined): unknown;
}

/** A round game, asked in this process. */
export function inProcess(game: AnyRound): RoundMaths {
	const answers = answer(game);

	return {
		keepsProgress: Boolean(game.progress),
		check: async (params) => answers.check(params),
		initialProgress: async () => answers.initialProgress(),
		start: async (...args) => answers.start(...args),
		act: async (...args) => answers.act(...args),
		conclude: async (...args) => answers.conclude(...args),
		view: async (...args) => answers.view(...args),
		progressView: async (progress) => answers.progressView(progress)
	};
}

/**
 * A site's studio games as they are played: their books opened where the site keeps
 * them, and each presented to the pipeline as a round game. `folderOf` says where a
 * game's books are, from the site's working directory: a site may hold several versions
 * of a game, each with books of its own. `versionsOf`, where a site keeps them, gives a
 * game's manifests, oldest first, so that what a player held at an earlier version is
 * carried into the one played (./counter-conversion.ts).
 */
export function createPlay(
	folderOf: (game: StudioRound) => string,
	versionsOf?: (game: StudioRound) => readonly GameManifest[]
) {
	/** By the game itself, not its slug: each version of a game is a game of its own. */
	const opened = new Map<StudioRound, Record<string, Book>>();
	const elsewhere = new Map<string, string>();
	const played = new WeakMap<StudioRound, BookGame>();
	const maths = new WeakMap<AnyRound | StudioRound, RoundMaths>();

	/** A game's books, opened once and held to what its listing published. */
	function booksOf(game: StudioRound): Record<string, Book> {
		let books = opened.get(game);

		if (!books) {
			// Books missing, or not the ones listed: the game cannot be played, and nothing is staked.
			try {
				books = openBooks(
					elsewhere.get(game.slug) ?? folderOf(game),
					game.books.tables
				);
			} catch (error) {
				throw new GameFailedError(
					`${game.slug}'s books could not be opened: ${error instanceof Error ? error.message : String(error)}`
				);
			}

			opened.set(game, books);
		}

		return books;
	}

	/** A studio's game as the round game the pipeline plays (the SDK's `bookGame`). */
	function bookRoundGame(game: StudioRound): BookGame {
		let found = played.get(game);

		if (!found) {
			found = bookGame(game.books, game.studio, () => booksOf(game));
			played.set(game, found);
		}

		return found;
	}

	/** Closes a game's books, if they were open. */
	function close(game: StudioRound): void {
		for (const book of Object.values(opened.get(game) ?? {})) book.close();
		opened.delete(game);
	}

	return {
		booksOf,
		bookRoundGame,

		/** Closes the books of a game a site no longer holds as it did: they are opened again when next played. */
		close,

		/**
		 * What answers for a round game: the game itself for a site's own (or a test's
		 * made-up one), and for a studio's game the reading of its books, which are data.
		 */
		roundMaths(game: AnyRound | StudioRound): RoundMaths {
			let found = maths.get(game);
			if (found) return found;

			if (isStudioRound(game))
				found = {
					...inProcess(bookRoundGame(game) as unknown as AnyRound),
					// What a player held at an earlier version, converted version by version.
					...(game.keepsProgress && versionsOf
						? {
								carry: (progress: unknown, from: string | undefined) =>
									convertThrough(
										versionsOf(game),
										from,
										(progress ?? {}) as Record<string, number>
									)
							}
						: {})
				};
			else if ("listed" in game)
				throw new GameFailedError(
					`${game.slug} is listed without books to play it from`
				);
			else found = inProcess(game);

			maths.set(game, found);

			return found;
		},

		/**
		 * For tests: says where a game's books are, in place of where the site keeps them,
		 * or with no folder puts them back. Closes the game's books if they were open.
		 */
		keepBooksIn(slug: string, folder: string | null): void {
			for (const game of [...opened.keys()]) if (game.slug === slug) close(game);

			if (folder === null) elsewhere.delete(slug);
			else elsewhere.set(slug, folder);
		}
	};
}
