/**
 * A studio's listing, read: what a site knows of a studio's games, from the
 * `listing.json` made of them (./listing-files.ts), checked as anything from outside is.
 *
 * Pure: a site's pages read it as well as its server.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import * as valibot from "valibot";
import { bookListing, type BookListing } from "./book-game.ts";
import { checkGuide, type GameGuide } from "./guide.ts";
import { SHAPES, type Shape } from "./shapes.ts";
import type { StakeSteps } from "./stake-steps.ts";

/** The file a studio's listing is kept in, in its folder. */
export const LISTING_FILE = "listing.json";

/**
 * A studio's game as a site knows it: what its listing says, and none of its code. It is
 * played from books: a round is a row drawn from them, and a bet is checked in the
 * player's page against the digests the listing published.
 */
export interface StudioRound {
	kind: "round";
	/** Known from a listing: there is no code here to call. */
	listed: true;
	slug: string;
	name: string;
	blurb: string;
	studio: string;
	category: "slots" | "games";
	guide: GameGuide;
	rtpBp: number;
	volatility: number;
	volatilityOf?: undefined;
	minStake?: number;
	maxStake?: number;
	/** What its bar moves the bet by, where it says: a site takes only a bet those steps reach. */
	steps?: StakeSteps;
	/**
	 * The shapes it has a view for: wide always, and tall if it is drawn for a phone. A site
	 * gives a game with no tall view a wide frame on a phone too.
	 */
	shapes: readonly Shape[];
	/** Whether the game keeps progress between bets. */
	keepsProgress: boolean;
	/**
	 * Its manifest, what each of its tables comes to and what the check found of each
	 * mode.
	 */
	books: BookListing;
}

/** Whether a game is a studio's, known from a listing. */
export const isStudioRound = (game: unknown): game is StudioRound =>
	typeof game === "object" && game !== null && "listed" in game && "books" in game;

const cents = valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(1));

/** One game's entry in a listing. What the guide is, `checkGuide` says. */
const entry = valibot.strictObject({
	fingerprint: valibot.pipe(valibot.string(), valibot.regex(/^[0-9a-f]{64}$/)),
	slug: valibot.string(),
	name: valibot.pipe(
		valibot.string(),
		valibot.trim(),
		valibot.minLength(1),
		valibot.maxLength(60)
	),
	blurb: valibot.pipe(valibot.string(), valibot.maxLength(200)),
	studio: valibot.string(),
	category: valibot.picklist(["slots", "games"]),
	rtpBp: valibot.pipe(
		valibot.number(),
		valibot.integer(),
		valibot.minValue(1),
		valibot.maxValue(9_999)
	),
	volatility: valibot.pipe(
		valibot.number(),
		valibot.gtValue(0),
		valibot.maxValue(1_000)
	),
	minStake: valibot.optional(cents),
	maxStake: valibot.optional(cents),
	// Checked as part of the game's manifest, in its books' record: carried here as it was.
	steps: valibot.optional(
		valibot.array(valibot.object({ under: valibot.optional(cents), by: cents }))
	),
	// Left out of a listing made before games said their shapes: wide only.
	shapes: valibot.optional(valibot.array(valibot.picklist(SHAPES)), ["wide"]),
	keepsProgress: valibot.boolean(),
	guide: valibot.unknown(),
	/** What a site plays the game from and checks its bets against: its books' record. */
	books: bookListing
});

/**
 * A studio's game as its listing says, checked. `listing` is the studio's `listing.json`
 * as read, or `undefined` if it has none. Throws, naming it, if the listing is wrong or is
 * of another game or studio.
 */
export function listedGame(
	listing: unknown,
	folder: string,
	studio: string,
	slug: string
): StudioRound {
	if (typeof listing !== "object" || listing === null)
		throw new Error(`${folder} has no ${LISTING_FILE}: list its games first.`);

	const parsed = valibot.safeParse(entry, (listing as Record<string, unknown>)[slug]);
	if (!parsed.success)
		throw new Error(
			`${folder}/${LISTING_FILE} does not list ${slug} as a site needs: ${parsed.issues[0].message}`
		);

	const { fingerprint: _, guide, ...game } = parsed.output;
	if (game.slug !== slug || game.studio !== studio)
		throw new Error(
			`${folder}/${LISTING_FILE} lists ${slug} as ${game.slug} of ${game.studio}, not of ${studio}`
		);

	return { ...game, kind: "round", listed: true, guide: checkGuide(slug, guide) };
}

/**
 * Whether bets on a game count toward a site's rewards. Rewards are a share of the house
 * edge, so a game with a mis-stated return could be profitable to grind: a site's own
 * games are held to exact tests, and a studio's game is listed only if its books pass the
 * check, which sums its return exactly, and is played only from those books. A game said
 * to be a studio's with no books listed earns nothing.
 */
export function earnsRewards(game: {
	slug: string;
	studio?: string;
	books?: unknown;
}): boolean {
	return game.studio === undefined || game.books !== undefined;
}
