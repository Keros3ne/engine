/**
 * How a studio game's built client is served: static files only (the page, its scripts,
 * art and sound), from the client's own folder and nowhere else, under the policy that
 * sandboxes them (the SDK's frame.ts).
 *
 * Author: dwclake
 * Created: 2026-11-19
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { CLIENT_FILE_TYPES, clientHeaders } from "./frame.ts";

export { clientHeaders };

/**
 * A file of a client built into `folder`, or `null` if there is no such file, it is of a
 * kind no client is made of, or the path leads outside the folder.
 */
export function clientFile(
	folder: string | undefined,
	file: string
): { body: Buffer; type: string } | null {
	if (!folder) return null;

	const root = resolve(folder);
	const path = resolve(join(root, normalize(file || "index.html")));
	// Nothing outside the client's own folder, whatever the path says.
	if (path !== root && !path.startsWith(root + sep)) return null;

	const type = CLIENT_FILE_TYPES[extname(path).toLowerCase()];
	if (!type || !existsSync(path) || !statSync(path).isFile()) return null;

	return { body: readFileSync(path), type };
}
