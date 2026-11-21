/**
 * How smoothly a game is drawn, measured where it is drawn: inside its frame, which
 * nothing outside can see into. The game's end of the conversation (./client.ts) counts
 * the frames its page is given, and reports them to a host that asked (`measure` in the
 * opening message): a page where a game is reviewed, or tried while it is made. A site
 * where a game is played does not ask, and nothing is counted there.
 *
 * What is counted is the page's own frames (`requestAnimationFrame`), which is what a
 * game draws on. A game that takes too long over a frame is given fewer of them, so the
 * count falls and the longest wait between two rises, whatever the game draws with.
 *
 * Author: dwclake
 * Created: 2026-11-21
 */

/** A wait between two frames longer than this is a slow one: under twenty frames a second. */
export const SLOW_FRAME_MS = 50;

/** How long is counted before a report is made, in milliseconds. */
export const REPORT_EVERY_MS = 1_000;

/** What a game reports of the frames it was given over one stretch of time. */
export interface FrameReport {
	/** How many frames the page was given. */
	frames: number;
	/** How long the stretch was, in milliseconds. */
	ms: number;
	/** The longest wait between two frames, in milliseconds. */
	longest: number;
	/** How many waits were slow ones (`SLOW_FRAME_MS`). */
	slow: number;
}

/** Frames a second, from a report: to one decimal place. */
export const framesASecond = (report: Pick<FrameReport, "frames" | "ms">): number =>
	report.ms > 0 ? Math.round((report.frames * 10_000) / report.ms) / 10 : 0;

/**
 * Counts frames as they come. `frame(now)` is called with the time of each, in
 * milliseconds, and `report` with what was counted each time `every` has passed.
 * `pause()` forgets the frame before: the wait across a time the page was not drawn at
 * all (hidden, in another tab) is nobody's slow frame.
 */
export function createFrameMeter(
	report: (counted: FrameReport) => void,
	every = REPORT_EVERY_MS
) {
	let since: number | null = null;
	let last: number | null = null;
	let frames = 0;
	let longest = 0;
	let slow = 0;

	const reset = (now: number | null) => {
		since = now;
		last = now;
		frames = 0;
		longest = 0;
		slow = 0;
	};

	return {
		frame(now: number) {
			if (since === null || last === null) return reset(now);

			const wait = now - last;
			last = now;
			frames += 1;
			longest = Math.max(longest, wait);
			if (wait > SLOW_FRAME_MS) slow += 1;

			if (now - since >= every) {
				report({
					frames,
					ms: Math.round(now - since),
					longest: Math.round(longest),
					slow
				});
				since = now;
				frames = 0;
				longest = 0;
				slow = 0;
			}
		},
		pause() {
			reset(null);
		}
	};
}

/** What a host keeps of a game's reports: how it is drawn now, and the worst it has been. */
export interface FrameSummary {
	/** Frames a second over the latest report. */
	now: number;
	/** The fewest frames a second any report held. */
	lowest: number;
	/** Frames a second over everything reported. */
	average: number;
	/** The longest wait between two frames, in milliseconds. */
	longest: number;
	/** Every frame reported, and how many of them were slow. */
	frames: number;
	slow: number;
	/** How long has been reported on, in milliseconds. */
	ms: number;
}

/** Adds a report to what a host has kept, or starts from it. */
export function addFrames(kept: FrameSummary | null, report: FrameReport): FrameSummary {
	const now = framesASecond(report);
	const frames = (kept?.frames ?? 0) + report.frames;
	const ms = (kept?.ms ?? 0) + report.ms;

	return {
		now,
		lowest: kept ? Math.min(kept.lowest, now) : now,
		average: framesASecond({ frames, ms }),
		longest: Math.max(kept?.longest ?? 0, report.longest),
		frames,
		slow: (kept?.slow ?? 0) + report.slow,
		ms
	};
}
