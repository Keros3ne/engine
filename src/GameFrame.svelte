<!--
A game, hosted: its client in a sandboxed frame, in whatever room the page gives it. The
frame can run scripts and nothing more: it has no access to the page, its cookies or the
network. Whatever the game needs it asks for through the bridge (./bridge.svelte.ts).

Whoever puts this on a page says only which game, where its client is, and who keeps the
player's bets (`site`). The page gives it room: this is as wide as the element it is in,
and no taller than `--game-room-height`, if the page sets that. From that room this
chooses which of the game's two views is shown (./shapes.ts), makes the frame that
shape, as large as fits, and tells the game. The frame is `iframe.game-frame`, for a page
or a test that needs to find it. Nothing else decides a game's view: not the
page round it, and not the game.

    <GameFrame {game} src="/studio-frame/{game.slug}/index.html" {site} {initial} {balance} />

Author: dwclake
Created: 2026-11-19
-->
<script lang="ts" generics="Extra">
	import {
		createGameBridge,
		type BridgeStart,
		type GameSite,
		type HostedGame
	} from "./bridge.svelte.ts";
	import type { RoundMessage } from "./protocol.ts";
	import { SHAPE_RATIO, fitIn, viewFor, type Shape } from "./shapes.ts";

	interface Props {
		game: HostedGame;
		/** Where the client's page is. */
		src: string;
		/** Whoever keeps the player's bets. */
		site: GameSite<Extra>;
		/** A round the player left open, to pick back up. */
		initial?: RoundMessage | null;
		/** The player's balance, in cents: told to the game when it changes for a reason outside it. */
		balance: number;
		/**
		 * Whether the game's frame may play sound without a press inside it. Asked only of a
		 * browser that knows the word: one that does not says so in its console.
		 */
		sound?: boolean;
		/** Whether the game is told to keep still. Left out, what the player's device asks. */
		reducedMotion?: boolean;
		/** Told of every message to and from the game, and of those ignored: for a page that shows them. */
		heard?: BridgeStart["heard"];
		/** Told how smoothly the game is drawn, each second or so. Given, the game is asked to count its frames. */
		onframes?: BridgeStart["frames"];
		/** Called with the view chosen, and how large the game is drawn, whenever either changes. */
		onroom?: (room: { view: Shape; width: number; height: number }) => void;
		/** Something the page should say under the game, if there is anything: bound, for the page to show in its own way. */
		problem?: string | null;
		/** Whether the last bet was refused for want of balance: bound, for a page that can offer more. */
		outOfFunds?: boolean;
	}

	let {
		game,
		src,
		site,
		initial = null,
		balance,
		sound = true,
		reducedMotion,
		heard,
		onframes,
		onroom,
		problem = $bindable(null),
		outOfFunds = $bindable(false)
	}: Props = $props();

	/** The room the page gives: this element's width, and the height the page limits it to, if it does. */
	let room = $state.raw<{ width: number; height?: number }>({ width: 0 });

	/** The view the game is shown in, chosen here from the room and from nothing else. */
	const view: Shape = $derived(viewFor(game, room));
	/** How large the frame is: the view's shape, as large as fits the room. */
	const size = $derived(room.width ? fitIn(view, room) : null);

	// The page makes this component again for each game, so reading these once is right.
	// svelte-ignore state_referenced_locally
	const bridge = createGameBridge(game, site, {
		round: initial,
		balance,
		view: "wide",
		reducedMotion,
		heard,
		frames: onframes
	});

	$effect(() => {
		if (size) onroom?.({ view, ...size });
	});

	$effect(() => {
		problem = bridge.problem;
		outOfFunds = bridge.outOfFunds;
	});

	/** Measures the room the page gives, and again whenever it changes. */
	function measure(element: HTMLElement) {
		const limit = element.querySelector<HTMLElement>(".limit")!;

		const read = () => {
			const width = element.clientWidth;
			// The page's limit to the game's height, where it sets one: a property with no
			// value leaves the probe with no height at all.
			const height = limit.clientHeight;

			room = height > 0 ? { width, height } : { width };
		};

		const watcher = new ResizeObserver(read);
		watcher.observe(element);
		watcher.observe(limit);
		read();

		return () => watcher.disconnect();
	}

	/** Passes on to the game what the page knows and it does not. */
	function follow(_frame: HTMLIFrameElement) {
		bridge.balanceChanged(balance);
		bridge.setView(view);
	}
</script>

<div class="engine-game" {@attach measure}>
	<!-- Never drawn: as tall as the page lets the game be, to be measured. -->
	<div class="limit" aria-hidden="true"></div>

	<iframe
		class={["game-frame", { waiting: !bridge.shown || !size }]}
		title="{game.name}, the game"
		{src}
		sandbox="allow-scripts"
		allow={sound ? "autoplay" : undefined}
		data-view={view}
		style:width={size ? `${size.width}px` : "100%"}
		style:aspect-ratio={SHAPE_RATIO[view]}
		{@attach bridge.attach}
		{@attach follow}
	></iframe>

	<!-- A canvas says nothing to a screen reader, so the game says what happened in words. -->
	<p class="status" role="status" aria-live="polite">{bridge.status}</p>
</div>

<style>
	.engine-game {
		position: relative;
		width: 100%;
	}

	/* The page's limit to the game's height, measured: no height where the page sets none. */
	.limit {
		position: absolute;
		top: 0;
		left: 0;
		width: 0;
		height: var(--game-room-height, 0px);
		visibility: hidden;
		pointer-events: none;
	}

	iframe {
		display: block;
		margin-inline: auto;
		border: 0;
		border-radius: var(--game-frame-radius, 6px);
		background: var(--game-frame-ground, transparent);
	}

	/* Out of sight until its page has said it has something to show: a browser gives a frame
	   a white ground of its own until its page has drawn. */
	iframe.waiting {
		opacity: 0;
	}

	/* For a screen reader only. */
	.status {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
