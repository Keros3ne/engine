/**
 * What the bet pipeline throws when a game cannot play a round: its books are not there,
 * or what it answered is not what a game may answer.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

/** A game could not play a round. The player is told only that, and nothing is staked. */
export class GameFailedError extends Error {
	constructor(readonly detail: string) {
		super("The game could not play that just now. Nothing was staked.");
	}
}
