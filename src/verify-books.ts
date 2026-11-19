/**
 * Checking bets on a studio's game in the player's browser. A site's own code does it (the
 * SDK's `verifyBookBet`): there is no code of a studio's to run. Each bet's round is drawn
 * again from its revealed seeds and held to the digests the game's listing published, with
 * the proofs the server sent for it (./play.ts).
 *
 * Pure: imported by the page.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import { verifyBookBet, type BookListing } from "./book-game.ts";
import { hashServerSeed } from "./rng.ts";
import type { HistoryProofs } from "./proofs.ts";

/** A settled bet as a site keeps it, with what its check needs. */
export interface VerifiableBet {
	game: string;
	params: unknown;
	/** The player's actions, as stored when the round ended. */
	state: unknown;
	result: unknown;
	multiplierBp: number;
	baseStake: number;
	payout: number;
	nonce: number;
	clientSeed: string;
	serverSeedHash: string;
	/** `null` while the bet's seed pair is still in use. */
	serverSeed: string | null;
}

/**
 * Whether each bet is what its seeds make it, by bet id. A bet whose seed is still
 * secret is left out; one the server sent nothing for does not check out.
 */
export function verifyBookBets(
	listing: BookListing,
	bets: readonly (VerifiableBet & { id: string })[],
	sent: HistoryProofs
): Record<string, boolean> {
	const checked: Record<string, boolean> = {};

	for (const bet of bets) {
		if (bet.serverSeed === null) continue;

		const steps = sent.bets[bet.id];
		const proofs = steps?.map((step) => ({ ...sent.tables[step.table], ...step }));

		checked[bet.id] =
			proofs !== undefined &&
			proofs.every((proof) => proof.pages !== undefined) &&
			hashServerSeed(bet.serverSeed) === bet.serverSeedHash &&
			verifyBookBet(listing, { ...bet, serverSeed: bet.serverSeed }, proofs);
	}

	return checked;
}
