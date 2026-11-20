/**
 * Which of a game's two views is shown in a room: the one rule for it.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */
import { describe, expect, it } from "vitest";
import { VIEW_SIZE, fitIn, viewFor } from "./shapes.ts";

const both = { shapes: ["wide", "tall"] as const };
const wideOnly = { shapes: ["wide"] as const };

describe("a game's view", () => {
	it("is the one drawn larger in the room, of the views the game has", () => {
		// A phone held upright, a phone on its side, a laptop, a wide monitor, a square.
		expect(viewFor(both, { width: 390, height: 700 })).toBe("tall");
		expect(viewFor(both, { width: 844, height: 340 })).toBe("wide");
		expect(viewFor(both, { width: 1200, height: 700 })).toBe("wide");
		expect(viewFor(both, { width: 2400, height: 1200 })).toBe("wide");
		expect(viewFor(both, { width: 800, height: 800 })).toBe("wide");
		// The two meet where a room is about four fifths as wide as it is tall: wider than
		// that the wide view is the larger picture, narrower the tall one.
		expect(viewFor(both, { width: 760, height: 800 })).toBe("wide");
		expect(viewFor(both, { width: 700, height: 800 })).toBe("tall");
		expect(viewFor(both, { width: 500, height: 800 })).toBe("tall");
	});

	it("is wide for a game with no tall view, and where the page sets no limit to its height", () => {
		expect(viewFor(wideOnly, { width: 390, height: 700 })).toBe("wide");
		expect(viewFor({}, { width: 390, height: 700 })).toBe("wide");
		expect(viewFor(both, { width: 390 })).toBe("wide");
	});

	it("is drawn as large as fits the room, in its own proportions", () => {
		expect(fitIn("wide", { width: 1600 })).toEqual({ width: 1600, height: 1000 });
		expect(fitIn("wide", { width: 1600, height: 500 })).toEqual({
			width: 800,
			height: 500
		});
		expect(fitIn("tall", { width: 390, height: 1600 })).toMatchObject({ width: 390 });
		expect(fitIn("tall", { width: 900, height: 800 })).toEqual({
			width: 450,
			height: 800
		});
	});

	it("has one size it is drawn at, in the proportions of its shape", () => {
		expect(VIEW_SIZE.wide.width / VIEW_SIZE.wide.height).toBe(16 / 10);
		expect(VIEW_SIZE.tall.width / VIEW_SIZE.tall.height).toBe(9 / 16);
	});
});
