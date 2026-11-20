/**
 * What a player held in a game's counters, carried from one version of the game to the
 * next. A game with counters keeps meters for each player at each size of bet, and what is
 * in them is worth something: a unit of a counter is counted at `worthBp` of the bet
 * (./game-manifest.ts), which the check of the game's books holds its table to. So when a
 * new version changes the counters, the units a player holds must become units of the new
 * ones without the player losing by it.
 *
 * The new version says how, as data in its `game.json` (`converts`): each counter of the
 * version before goes into one counter of this one, its units multiplied by `times` over
 * `over` and rounded up. Nothing of a studio's is run to convert anything. A site takes an
 * update only if `checkUpdate` finds that nobody, whatever they held, is left holding less
 * than they held, and it says the most the rounding up can give away.
 *
 * Pure: a site converts on its server, and a player's page converts the same way to check
 * that each bet held what the bet before left.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { stakeLimits, stakeOffered } from "./bets.ts";
import { versionAfter, type GameCounter, type GameManifest } from "./game-manifest.ts";
import { SITE_STEPS, stakeLadder } from "./stake-steps.ts";

/** How many units of each counter are held, by counter. */
type Counters = Record<string, number>;

/** The units held of a counter, as kept: a whole number, never less than nothing. */
const unitsOf = (held: Readonly<Counters>, id: string): number => {
	const kept = held[id];

	return Number.isSafeInteger(kept) && kept > 0 ? kept : 0;
};

/** What `units` of a counter become under a conversion: multiplied, divided, rounded up. */
const converted = (units: number, by: { times: number; over: number }): number =>
	Math.ceil((units * by.times) / by.over);

/** Whether two versions' counters are the same to hold: the same counters, each as full and worth as much. */
function sameCounters(
	before: readonly GameCounter[],
	after: readonly GameCounter[]
): boolean {
	return (
		before.length === after.length &&
		before.every((old) => {
			const now = after.find((each) => each.id === old.id);

			return now?.full === old.full && now.worthBp === old.worthBp;
		})
	);
}

/**
 * What a player holds in a version's counters, given what they held in the version
 * before. A version that says nothing of converting leaves each counter as it was; one
 * that does starts each of its counters from the old one converted into it, or from
 * nothing. A counter is never left full: what `checkUpdate` passed cannot fill one.
 */
export function convertCounters(next: GameManifest, held: Readonly<Counters>): Counters {
	const counters = next.counters ?? [];
	if (!next.converts)
		return Object.fromEntries(
			counters.map((each) => [
				each.id,
				Math.min(unitsOf(held, each.id), each.full - 1)
			])
		);

	const sources = Object.entries(next.converts.counters);

	return Object.fromEntries(
		counters.map((each) => {
			const source = sources.find(([, by]) => by.to === each.id);
			const units = source ? converted(unitsOf(held, source[0]), source[1]) : 0;

			return [each.id, Math.min(units, each.full - 1)];
		})
	);
}

/**
 * What a player holds in the latest of a game's versions, given what they held at
 * `from`. `versions` are the game's manifests, oldest first, as a site has published
 * them. What was kept at a version the site does not know, or before versions were kept,
 * is taken as held in the latest.
 */
export function convertThrough(
	versions: readonly GameManifest[],
	from: string | undefined,
	held: Readonly<Counters>
): Counters {
	const at = versions.findIndex((each) => each.version === from);
	if (at < 0) return { ...held };

	return versions
		.slice(at + 1)
		.reduce<Counters>((carried, next) => convertCounters(next, carried), {
			...held
		});
}

/** What `checkUpdate` found of an update to a game. */
export interface UpdateCheck {
	/** Why the update cannot be taken, in words. Empty when it can. */
	problems: string[];
	/**
	 * The most a player can gain by the conversion, in basis points of their bet: what
	 * rounding up gives away at worst, over all the counters together.
	 */
	excessBp: number;
}

/**
 * Whether a version of a game may follow another on a site, as far as what players hold:
 * its version comes after, it offers every size of bet a player may be holding counters
 * at, and its counters take everything held in the old ones at no loss to anyone.
 */
export function checkUpdate(before: GameManifest, next: GameManifest): UpdateCheck {
	const problems: string[] = [];
	let excessBp = 0;

	if (before.slug !== next.slug)
		problems.push(`it is ${next.slug}, and what it follows is ${before.slug}`);
	if (!versionAfter(next.version, before.version))
		problems.push(
			`its version, ${next.version}, does not come after ${before.version}`
		);

	const old = before.counters ?? [];
	const now = next.counters ?? [];
	// With no counters before, nobody holds anything to carry.
	if (old.length === 0) {
		if (next.converts)
			problems.push(
				`it converts counters from ${next.converts.from}, which had none`
			);

		return { problems, excessBp };
	}

	// Counters are kept at each size of bet: a size no longer offered would strand them.
	const dropped = stakeLadder(
		{ min: stakeLimits(before).minStake, max: stakeLimits(before).maxStake },
		before.steps ?? SITE_STEPS
	).filter((stake) => !stakeOffered(next, stake));
	if (dropped.length > 0)
		problems.push(
			`it no longer offers ${dropped.length === 1 ? "a bet" : "bets"} that ${before.version} did (${dropped
				.slice(0, 3)
				.map((cents) => (cents / 100).toFixed(2))
				.join(
					", "
				)}${dropped.length > 3 ? ", ..." : ""}): players hold counters at each size of bet`
		);

	if (now.length === 0) {
		problems.push(
			`it has no counters, and ${before.version} had: what players hold in them cannot be taken away`
		);

		return { problems, excessBp };
	}

	if (!next.converts) {
		if (!sameCounters(old, now))
			problems.push(
				`its counters are not ${before.version}'s, and it does not say how to convert them (converts, in game.json)`
			);

		return { problems, excessBp };
	}

	if (next.converts.from !== before.version)
		problems.push(
			`it converts counters from ${next.converts.from}, and the version before it is ${before.version}`
		);

	for (const counter of old) {
		const by = next.converts.counters[counter.id];
		const into = by && now.find((each) => each.id === by.to);

		if (!by || !into) {
			problems.push(
				`it does not say what becomes of the counter "${counter.id}": every counter of ${before.version} is converted into one of its own`
			);
			continue;
		}

		// Every amount a player may hold, from nothing to one short of full.
		let most = 0;
		for (let units = 0; units < counter.full; units++) {
			const becomes = converted(units, by);
			const gain = becomes * into.worthBp - units * counter.worthBp;

			if (becomes >= into.full) {
				problems.push(
					`${units} of "${counter.id}" would become ${becomes} of "${into.id}", which is full at ${into.full}: a conversion fills no counter`
				);
				break;
			}
			if (gain < 0) {
				problems.push(
					`${units} of "${counter.id}", worth ${units * counter.worthBp} basis points of the bet, would become ${becomes} of "${into.id}", worth ${becomes * into.worthBp}: a conversion leaves nobody with less`
				);
				break;
			}

			most = Math.max(most, gain);
		}

		excessBp += most;
	}

	for (const id of Object.keys(next.converts.counters))
		if (!old.some((each) => each.id === id))
			problems.push(
				`it converts a counter "${id}", which ${before.version} did not have`
			);

	return { problems, excessBp };
}
