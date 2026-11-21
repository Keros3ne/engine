/**
 * The count of a game's frames (./frame-rate.ts): what is reported of frames that come
 * evenly, of one that is late, and of a page that was not drawn for a while.
 *
 * Author: dwclake
 * Created: 2026-11-21
 */
import { describe, expect, it } from "vitest";
import {
	addFrames,
	createFrameMeter,
	framesASecond,
	type FrameReport
} from "./frame-rate.ts";

/** A meter, and what it has reported. */
function meter() {
	const reports: FrameReport[] = [];

	return { reports, ...createFrameMeter((report) => reports.push(report)) };
}

describe("a game's frames, counted", () => {
	it("reports sixty a second of frames that come evenly", () => {
		const counted = meter();
		for (let frame = 0; frame <= 120; frame++) counted.frame((frame * 1_000) / 60);

		expect(counted.reports).toHaveLength(2);
		expect(counted.reports[0]).toMatchObject({ frames: 60, ms: 1_000, slow: 0 });
		expect(counted.reports[0].longest).toBe(17);
		expect(framesASecond(counted.reports[0])).toBe(60);
	});

	it("counts a late frame as slow, and says how long the longest wait was", () => {
		const counted = meter();
		let now = 0;
		counted.frame(now);
		for (let frame = 0; frame < 30; frame++) counted.frame((now += 16));
		counted.frame((now += 200));
		for (let frame = 0; frame < 30; frame++) counted.frame((now += 16));

		// The second is up twenty frames after the late one: fifty-one frames, not sixty.
		expect(counted.reports).toEqual([
			{ frames: 51, ms: 1_000, longest: 200, slow: 1 }
		]);
		expect(framesASecond(counted.reports[0])).toBe(51);
	});

	it("does not take the time a page was hidden for a slow frame", () => {
		const counted = meter();
		for (let now = 0; now <= 500; now += 20) counted.frame(now);
		counted.pause();
		// A minute in another tab, then drawn again.
		for (let now = 60_000; now <= 61_000; now += 20) counted.frame(now);

		expect(counted.reports).toEqual([
			{ frames: 50, ms: 1_000, longest: 20, slow: 0 }
		]);
	});

	it("is kept by a host as how it is drawn now and the worst it has been", () => {
		let kept = addFrames(null, { frames: 60, ms: 1_000, longest: 17, slow: 0 });
		kept = addFrames(kept, { frames: 20, ms: 1_000, longest: 180, slow: 6 });
		kept = addFrames(kept, { frames: 58, ms: 1_000, longest: 30, slow: 0 });

		expect(kept).toEqual({
			now: 58,
			lowest: 20,
			average: 46,
			longest: 180,
			frames: 138,
			slow: 6,
			ms: 3_000
		});
	});
});
