<!--
A game's two views, and the one of them that is shown. A game draws itself twice: wide,
16 by 10, which every game has, and tall, 9 by 16, for a game drawn for a phone too. Which
is shown is not the game's to decide, nor the page's round it: whoever hosts the game
chooses, from the room the page gives it (./shapes.ts, ./GameFrame.svelte), and tells the
game. This shows the view it was told, and the other when it is told that.

A game hands over its two views, as components, and what both are given:

    <Views {host} wide={WideView} tall={TallView} props={{ game }} />

A view is made again when the other was showing (a phone turned in full screen), so what
a game knows (its round, its balance) is kept above its views and passed to them, never in
them. A story shows one view whatever it is told, with `show`.

Author: dwclake
Created: 2026-11-19
-->
<script lang="ts" generics="Props extends Record<string, unknown>">
	import type { Component } from "svelte";
	import type { Shape } from "./shapes.ts";

	interface ViewsProps {
		/** The host the game is connected to: it says which view to show. */
		host: { init: { view: Shape }; onView(listener: (view: Shape) => void): void };
		/** The game at 16 by 10. */
		wide: Component<Props>;
		/** The game at 9 by 16, for a game that has such a view. Without it, wide is shown always. */
		tall?: Component<Props>;
		/** What both views are given. */
		props: Props;
		/** The view to show whatever the host says: for a story of one view. */
		show?: Shape;
	}

	let { host, wide, tall, props, show }: ViewsProps = $props();

	// The view the game was told when it connected, and whatever it is told after.
	// svelte-ignore state_referenced_locally
	let told = $state<Shape>(host.init.view);
	// svelte-ignore state_referenced_locally
	host.onView((view) => (told = view));

	const Shown = $derived((show ?? told) === "tall" && tall ? tall : wide);
</script>

<Shown {...props} />
