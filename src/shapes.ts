/**
 * The two shapes a game is drawn in. The site gives a game's frame one of them, at any
 * size: `wide`, 16 by 10, which every game has; and `tall`, 9 by 16, on a phone, for a
 * game that has a view drawn for it (`shapes` in its `game.json`). A game with no tall
 * view is shown wide on a phone too, across the screen's width.
 *
 * Pure: the site reads it on the server as well as in the browser. What follows a game's
 * shape in the page is ./shape.svelte.ts.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

export const SHAPES = ["wide", "tall"] as const;
export type Shape = (typeof SHAPES)[number];

/** Each shape's width over its height. */
export const SHAPE_RATIO: Record<Shape, number> = { wide: 16 / 10, tall: 9 / 16 };

/**
 * The size each shape is drawn at. A view is one picture of this many pixels, scaled as a
 * whole to whatever room it is given: nothing in a game is laid out by the size of the
 * screen, only by which of its two views is shown.
 */
export const VIEW_SIZE: Record<Shape, { width: number; height: number }> = {
	wide: { width: 1600, height: 1000 },
	tall: { width: 900, height: 1600 }
};

/** The room a game is given on a page, in pixels. No `height` where the page sets no limit to it. */
export interface Room {
	width: number;
	height?: number;
}

/** How large a shape is drawn in a room: as large as fits, in its own proportions. */
export function fitIn(shape: Shape, room: Room): { width: number; height: number } {
	const ratio = SHAPE_RATIO[shape];
	const width =
		room.height === undefined
			? room.width
			: Math.min(room.width, room.height * ratio);

	return { width, height: width / ratio };
}

/**
 * The view a game is shown in, in the room a page gives it: of the views the game has,
 * the one that is drawn larger there. This is the only place that is decided. A page that
 * sets no limit to the game's height is given the wide view, which every game has.
 */
export function viewFor(game: { shapes?: readonly Shape[] }, room: Room): Shape {
	if (room.height === undefined || shapeFor(game, "tall") !== "tall") return "wide";

	const area = (shape: Shape) => {
		const { width, height } = fitIn(shape, room);

		return width * height;
	};

	return area("tall") > area("wide") ? "tall" : "wide";
}

/** The shape of a game this many pixels wide and high: tall where it is higher than it is wide. */
export function shapeOf(width: number, height: number): Shape {
	return height > width ? "tall" : "wide";
}

/**
 * The shape a game is given where the screen would have this one: the same, if the game
 * has a view for it, and wide otherwise.
 */
export function shapeFor(game: { shapes?: readonly Shape[] }, wanted: Shape): Shape {
	return (game.shapes ?? ["wide"]).includes(wanted) ? wanted : "wide";
}
