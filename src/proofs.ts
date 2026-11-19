/**
 * What a player's browser is sent to check their bets on a studio's game: for each row a
 * round drew, the proof that it is in the table the listing published the digest of (the
 * SDK's `verifyBookBet`). A site reads the bets from wherever it keeps them, and makes
 * the proofs from the game's books with these.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import type { Book } from "./book-files.ts";
import { sendProof, type BookResult, type SentProof } from "./book-game.ts";

/** What a browser is sent to check several bets on one game: each table's pages once. */
export interface HistoryProofs {
	/** For each table a bet drew from: its rows, its weight and its list of pages. */
	tables: Record<string, Pick<SentProof, "rows" | "totalWeight" | "pages">>;
	/** For each bet that can be checked, by id: one entry for each row its round drew. */
	bets: Record<
		string,
		(Pick<SentProof, "page" | "leaves" | "line"> & { table: string })[]
	>;
}

/** A proof for each row a settled round drew, in order. */
export function proofsOf(books: Record<string, Book>, result: unknown): SentProof[] {
	return (result as BookResult).steps.map((step) =>
		sendProof(books[step.table].prove(step.row))
	);
}

/**
 * Proofs for several settled bets on one game, by bet id. A table's list of pages is the
 * same for every bet, so it is sent once.
 */
export function historyProofsOf(
	books: Record<string, Book>,
	bets: readonly { id: string; result: unknown }[]
): HistoryProofs {
	const proofs: HistoryProofs = { tables: {}, bets: {} };

	for (const bet of bets)
		proofs.bets[bet.id] = (bet.result as BookResult).steps.map((step) => {
			const {
				rows: count,
				totalWeight,
				pages,
				...rest
			} = sendProof(books[step.table].prove(step.row));

			proofs.tables[step.table] ??= { rows: count, totalWeight, pages };

			return { table: step.table, ...rest };
		});

	return proofs;
}
