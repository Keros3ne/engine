/**
 * The host's end of the conversation with a game's client. A client runs in a sandboxed
 * frame and can do nothing by itself: it asks, and this checks what it asked (./host.ts)
 * and passes it on to whoever keeps the player's bets, the `GameSite` it is given. A site
 * gives one that calls its own functions; a game played alone is given one over the
 * stand-in (./stand-in.ts). The conversation itself is the same wherever a game is hosted.
 *
 * It also keeps a result from being given away: a round is settled the moment it is
 * asked for, but the game has still to show it, so what would say how it came out (the new
 * balance, anything else the round brought) is held until the game says it has been shown.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import * as v from "valibot";
import { stakeLimits } from "./bets.ts";
import { ANNOUNCE_MAX, SETTLE_FALLBACK_MS, fromGame } from "./host.ts";
import {
	PROTOCOL,
	PROTOCOL_FAMILY,
	type FromSite,
	type HistoryBet,
	type RoundMessage
} from "./protocol.ts";
import type { Shape } from "./shapes.ts";

/** What comes back when a round is opened or moved in. */
export type SiteReply<Extra = unknown> =
	| {
			ok: true;
			round: RoundMessage;
			/** What else the round brought, which is the host's to show and not the game's. */
			extra?: Extra | null;
	  }
	| { ok: false; reason: "insufficient" | "rejected"; message: string };

/** Whoever keeps the player's bets, as a hosted game reaches them. */
export interface GameSite<Extra = unknown> {
	open(bet: number, params: unknown): Promise<SiteReply<Extra>>;
	act(action: unknown): Promise<SiteReply<Extra>>;
	/** The player's progress at a bet, as they may see it. */
	progress(bet: number): Promise<unknown>;
	history(): Promise<HistoryBet[]>;
	/** A round was opened and left open: what it cost has left the balance, which gives nothing away. */
	staked?(): void;
	/**
	 * The game has shown a settled round's result (or was given long enough to): the balance
	 * may be shown now, and whatever else was held back. `extra` is what the rounds settled
	 * since the last time brought, the newest that brought anything.
	 */
	revealed?(extra: Extra | null): void;
}

/** A game as its host needs to know it. */
export interface HostedGame {
	slug: string;
	name: string;
	minStake?: number;
	maxStake?: number;
	shapes?: readonly Shape[];
}

/** How long a game's frame is kept out of sight if its page never says it has drawn. */
const SHOW_ANYWAY_MS = 4_000;

/** What a bridge is started with. */
export interface BridgeStart {
	/** A round the player left open, to pick back up. */
	round: RoundMessage | null;
	balance: number;
	view: Shape;
	/** Whether the game is told to keep still. Left out, what the player's device asks. */
	reducedMotion?: boolean;
	/**
	 * Told of every message, for a page that shows them (a studio's own, while a game is
	 * made): what the game sent, what it was sent, and what was ignored, with why.
	 */
	heard?(kind: "in" | "out" | "ignored", message: unknown, why?: string): void;
}

/** The bridge for one game in one frame. */
export function createGameBridge<Extra = unknown>(
	game: HostedGame,
	site: GameSite<Extra>,
	start: BridgeStart
) {
	// What the page around the frame shows.
	let status = $state("");
	let problem = $state<string | null>(null);
	// Whether the game's page has said it has something to show. Until then the frame is
	// kept out of sight: a browser gives a frame a white ground of its own until its page
	// has drawn, which showed as a white flash before a game's loading screen.
	let shown = $state(false);
	let showAnyway: ReturnType<typeof setTimeout> | undefined;
	let outOfFunds = $state(false);

	let frame: HTMLIFrameElement | null = null;
	let balance = start.balance;
	let view = start.view;
	// Whether the game has been told how things stand: before that it is told nothing else.
	let begun = false;
	// A round that has settled but whose result the game is still showing.
	let unsettled = false;
	let held: Extra | null = null;
	let fallback: ReturnType<typeof setTimeout> | undefined;

	// The frame's origin is its own and has no name, so there is nothing to
	// address but "*". Nothing secret is ever sent.
	const post = (message: FromSite) => {
		start.heard?.("out", message);
		frame?.contentWindow?.postMessage({ protocol: PROTOCOL, ...message }, "*");
	};

	/** The result has been shown, or enough time has passed: what was held back is let go. */
	function settle() {
		if (!unsettled) return;

		unsettled = false;
		clearTimeout(fallback);

		const extra = held;
		held = null;
		site.revealed?.(extra);
	}

	/** Opens a round or moves in one, and tells the game what came of it. */
	async function round(replyTo: number, request: () => Promise<SiteReply<Extra>>) {
		let response: SiteReply<Extra>;
		try {
			response = await request();
		} catch {
			response = {
				ok: false,
				reason: "rejected",
				message: "That did not go through. Try again."
			};
		}

		if (!response.ok) {
			// A balance too small is the one refusal the page shows too: only it can offer more.
			outOfFunds = response.reason === "insufficient";
			problem = outOfFunds ? response.message : null;
			post({
				type: "refused",
				id: replyTo,
				reason: response.reason,
				message: response.message
			});

			return;
		}

		problem = null;
		outOfFunds = false;
		balance = response.round.balance;
		post({ type: "round", id: replyTo, round: response.round });

		if (response.round.open) {
			site.staked?.();
		} else {
			// The result is known here before the game has shown it. Hold everything
			// that would give it away until the game says it has.
			unsettled = true;
			// Kept if something is already held: on autoplay the next round can end before the
			// game has said the last one was shown, and its empty hand must not replace it.
			held = response.extra ?? held;
			clearTimeout(fallback);
			fallback = setTimeout(settle, SETTLE_FALLBACK_MS);
		}
	}

	/** Answers something the game asked to read, or says it could not be read. */
	async function read(replyTo: number, answer: () => Promise<FromSite>) {
		try {
			post(await answer());
		} catch {
			post({
				type: "refused",
				id: replyTo,
				reason: "rejected",
				message: "That could not be read. Try again."
			});
		}
	}

	async function receive(event: MessageEvent) {
		// Only this game's own frame is listened to, and only messages of the agreed shapes.
		if (!frame || event.source !== frame.contentWindow) return;

		const protocol: unknown = event.data?.protocol;
		if (protocol !== PROTOCOL) {
			// A client built for another protocol: say so, rather than leave the game waiting
			// for an answer that never comes.
			if (typeof protocol === "string" && protocol.startsWith(PROTOCOL_FAMILY)) {
				problem =
					"This game was built for another version of the site, and cannot be played here.";
				start.heard?.(
					"ignored",
					event.data,
					`it speaks ${protocol}, and this host ${PROTOCOL}`
				);
			}

			return;
		}

		const parsed = v.safeParse(fromGame, event.data);
		if (!parsed.success) {
			start.heard?.(
				"ignored",
				event.data,
				"it is not a message a host understands"
			);

			return;
		}

		const message = parsed.output;
		start.heard?.("in", message);

		switch (message.type) {
			case "drawn":
				shown = true;
				break;
			case "ready":
				// A page with no loading screen says nothing before this.
				shown = true;
				begun = true;
				post({
					type: "init",
					game: { slug: game.slug, name: game.name },
					balance,
					limits: stakeLimits(game),
					reducedMotion:
						start.reducedMotion ??
						matchMedia("(prefers-reduced-motion: reduce)").matches,
					round: start.round?.open ? start.round : null,
					view
				});
				break;
			case "open":
				await round(message.id, () => site.open(message.bet, message.params));
				break;
			case "act":
				await round(message.id, () => site.act(message.action));
				break;
			case "settled":
				settle();
				break;
			case "announce":
				status = message.text.slice(0, ANNOUNCE_MAX);
				break;
			case "progress":
				await read(message.id, async () => ({
					type: "progress",
					id: message.id,
					bet: message.bet,
					progress: await site.progress(message.bet)
				}));
				break;
			case "history":
				await read(message.id, async () => ({
					type: "history",
					id: message.id,
					bets: await site.history()
				}));
				break;
		}
	}

	return {
		/** Words the game has asked to have read out. */
		get status() {
			return status;
		},
		/** Something the page should say: a balance too small, or a game that cannot be played here. */
		get problem() {
			return problem;
		},
		/** Whether the game's page has something to show: the frame is out of sight until it has. */
		get shown() {
			return shown;
		},
		/** Whether the last bet was refused for want of balance. */
		get outOfFunds() {
			return outOfFunds;
		},
		/** Attach to the frame: listens while it is on the page. */
		attach(element: HTMLIFrameElement) {
			frame = element;
			window.addEventListener("message", receive);
			// A page that never says so (one that failed to load) is shown as it is.
			showAnyway = setTimeout(() => (shown = true), SHOW_ANYWAY_MS);

			return () => {
				window.removeEventListener("message", receive);
				clearTimeout(fallback);
				clearTimeout(showAnyway);
				frame = null;
			};
		},
		/** Tells the game a balance that changed for a reason of the host's own, such as a claim. */
		balanceChanged(next: number) {
			if (next === balance || unsettled) return;

			balance = next;
			if (begun) post({ type: "balance", balance });
		},
		/** The view the game is to show: told to it when it changes, and when it first asks. */
		setView(next: Shape) {
			if (next === view) return;

			view = next;
			if (begun) post({ type: "view", view });
		}
	};
}

export type GameBridge = ReturnType<typeof createGameBridge>;
