/**
 * The engine's tests: `bun run test`. They run on Bun, as the engine does.
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: { include: ["src/**/*.spec.ts"], testTimeout: 60_000, maxWorkers: 4 }
});
