/**
 * A game as the one file it travels in: a studio packs a version of a game, and a site
 * installs what it was sent. Nothing else of the studio's goes with it, and no site needs
 * to see where the game was made.
 *
 *   stormglass-1.7.0.tar.gz
 *     release.json   what the package holds: the game, its version, the protocol its
 *                    client speaks, and every file in it by its place, size and digest
 *     game.json      the game's manifest (./game-manifest.ts)
 *     guide.json     its rules and paytable, as words and tables (./guide.ts)
 *     card.svg       the picture a site lists it under
 *     client/        its client as it was built: index.html and what that loads
 *     maths/         what its maths made: books.json, and each table's .index and .rows
 *     assets/        what else it is made of (sound, pictures), where it has any
 *
 * It is an ordinary archive, which `tar -xzf` opens. The same game packs to the same
 * bytes wherever it is packed.
 *
 * A site installs a package only whole and only as it says it is: every file the one
 * `release.json` names, of the size and digest it names, and no other; a manifest and a
 * guide that pass their checks; a client that speaks the site's protocol and is made only
 * of the kinds of file a client may be made of; and books that pass the whole check, every
 * row read and every mode's return summed. Nothing in a package is run to install it.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { createHash } from "node:crypto";
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import * as valibot from "valibot";
import type { BookListing } from "./book-game.ts";
import { checkGameFolder, type CheckedGame } from "./book-files.ts";
import { BOOK_NAME } from "./book.ts";
import { CLIENT_FILE_TYPES } from "./frame.ts";
import { BOOK_RTP_BP, GAME_VERSION } from "./game-manifest.ts";
import { checkGuide } from "./guide.ts";
import { PROTOCOL } from "./protocol.ts";
import { isPlace, tarBytes, tarEntries, type TarFile } from "./tar.ts";

/** The file of a package that says what the package holds. */
export const PACKAGE_RECORD = "release.json";

/** The way a package is laid out, as its record says it: raised if the layout changes. */
export const PACKAGE_FORMAT = 1;

/** The files every package has, by their places. */
const REQUIRED = [
	"game.json",
	"guide.json",
	"card.svg",
	"client/index.html",
	"maths/books.json"
];

/** The folders a package's other files are in. */
const FOLDERS = ["client/", "maths/", "assets/"];

/** The most a package may come to, unpacked, unless a site says otherwise. */
const MOST_BYTES = 4_000_000_000;

/** The most `release.json` itself may come to. */
const MOST_RECORD_BYTES = 8_000_000;

const digest = valibot.pipe(valibot.string(), valibot.regex(/^[0-9a-f]{64}$/));

const record = valibot.strictObject({
	format: valibot.literal(PACKAGE_FORMAT),
	slug: valibot.pipe(valibot.string(), valibot.regex(BOOK_NAME), valibot.maxLength(40)),
	version: valibot.pipe(valibot.string(), valibot.regex(GAME_VERSION)),
	/** What packed it: said for people, and held to nothing. */
	sdk: valibot.optional(valibot.string()),
	/** The protocol its client speaks to a site in (./protocol.ts). */
	protocol: valibot.string(),
	/**
	 * The conditions its client was built under, if any: packages taken from their clones,
	 * not at their tags. Such a package is for trying a change, and is never published.
	 */
	conditions: valibot.optional(valibot.array(valibot.string())),
	/** Every other file of the package, by its place: its size in bytes and its SHA-256. */
	files: valibot.record(
		valibot.pipe(valibot.string(), valibot.check(isPlace)),
		valibot.strictObject({
			size: valibot.pipe(valibot.number(), valibot.integer(), valibot.minValue(0)),
			sha256: digest
		})
	)
});

/** What a package says it holds. */
export type PackageRecord = valibot.InferOutput<typeof record>;

/** The name of the file a version of a game is packed into: `stormglass-1.7.0.tar.gz`. */
export function packedName(slug: string, version: string): string {
	return `${slug}-${version}.tar.gz`;
}

/** Whether a place is one a file of a package may have. */
function belongs(name: string): boolean {
	return (
		isPlace(name) &&
		(REQUIRED.includes(name) || FOLDERS.some((folder) => name.startsWith(folder)))
	);
}

/** A file's SHA-256 and its size, read through once. */
export async function fileDigest(
	file: string
): Promise<{ sha256: string; size: number }> {
	const hash = createHash("sha256");
	let size = 0;

	for await (const part of createReadStream(file) as AsyncIterable<Buffer>) {
		hash.update(part);
		size += part.length;
	}

	return { sha256: hash.digest("hex"), size };
}

/** A file to put in a package: its place there, and where it is on disk. */
export interface PackedFile {
	/** Its place in the package: `client/index.html`. */
	name: string;
	/** The file on disk. */
	file: string;
}

/**
 * Writes a package into the folder `into`, from the files given, in the order given. It
 * checks nothing of the game: whoever packs holds the game to its checks first. Returns
 * the package's name, and its own size and digest, which is how a site tells that the
 * file it was sent is the file that was published.
 */
export async function writePackage(
	into: string,
	about: Omit<PackageRecord, "format" | "files">,
	files: readonly PackedFile[]
): Promise<{ name: string; sha256: string; size: number }> {
	const entries: [string, { size: number; sha256: string }][] = [];

	for (const { name, file } of files) {
		if (!belongs(name) || name === PACKAGE_RECORD)
			throw new Error(`${name} is not a place a file of a package may have.`);
		if (entries.some(([had]) => had === name))
			throw new Error(`${name} is in the package twice.`);

		entries.push([name, await fileDigest(file)]);
	}

	for (const name of REQUIRED)
		if (!entries.some(([had]) => had === name))
			throw new Error(`A package has a ${name}, and this one was given none.`);

	const written = Buffer.from(
		`${JSON.stringify(
			valibot.parse(record, {
				format: PACKAGE_FORMAT,
				...about,
				files: Object.fromEntries(entries)
			}),
			null,
			"\t"
		)}\n`
	);

	// The record first: whoever reads the package knows what is coming before it comes.
	const tar: TarFile[] = [
		{ name: PACKAGE_RECORD, size: written.length, bytes: () => [written] },
		...files.map(({ name, file }, index) => ({
			name,
			size: entries[index][1].size,
			bytes: () => createReadStream(file)
		}))
	];

	// Written beside its place, and put there only once all of it has been.
	mkdirSync(into, { recursive: true });
	const name = packedName(about.slug, about.version);
	const packed = join(into, name);
	const coming = `${packed}.coming`;

	try {
		await pipeline(
			Readable.from(tarBytes(tar)),
			createGzip(),
			createWriteStream(coming)
		);
		renameSync(coming, packed);
	} finally {
		rmSync(coming, { force: true });
	}

	return { name, ...(await fileDigest(packed)) };
}

/** A package installed: what it said it held, and what its checks found. */
export interface InstalledPackage {
	/** The folder it was installed into. */
	folder: string;
	record: PackageRecord;
	/** Its manifest, what its books come to, and what the check of them found. */
	checked: CheckedGame;
}

/** A package's record, from the folder it was installed into. Throws if it is not one. */
export function readPackageRecord(folder: string): PackageRecord {
	return valibot.parse(
		record,
		JSON.parse(readFileSync(join(folder, PACKAGE_RECORD), "utf8"))
	);
}

/**
 * Why a package, unpacked into `folder`, is not a game a site can hold, in words: what its
 * files say of themselves, and the whole check of its books, which is made once and
 * given back with them. No problems when it is.
 */
function checkUnpacked(
	folder: string,
	held: PackageRecord
): { problems: string[]; checked?: CheckedGame } {
	const problems: string[] = [];

	if (held.protocol !== PROTOCOL)
		problems.push(
			`its client speaks ${held.protocol}, and this site speaks ${PROTOCOL}`
		);

	// A client and its assets are served as they are: only what a client may be made of.
	for (const name of Object.keys(held.files))
		if (
			(name.startsWith("client/") || name.startsWith("assets/")) &&
			!CLIENT_FILE_TYPES[extname(name).toLowerCase()]
		)
			problems.push(`${name} is a kind of file no game is made of`);

	try {
		checkGuide(
			held.slug,
			JSON.parse(readFileSync(join(folder, "guide.json"), "utf8"))
		);
	} catch (error) {
		problems.push(error instanceof Error ? error.message : String(error));
	}

	let checked: CheckedGame;
	try {
		checked = checkGameFolder(folder, join(folder, "maths"));
	} catch (error) {
		return {
			problems: [
				...problems,
				error instanceof Error ? error.message : String(error)
			]
		};
	}

	if (checked.game.slug !== held.slug || checked.game.version !== held.version)
		problems.push(
			`its game.json is of ${checked.game.slug} at ${checked.game.version}, and the package says ${held.slug} at ${held.version}`
		);

	// Its books are the tables their record names, and nothing beside them.
	const tables = new Set(
		Object.keys(checked.books.tables).flatMap((table) => [
			`maths/${table}.index`,
			`maths/${table}.rows`
		])
	);
	for (const name of Object.keys(held.files))
		if (name.startsWith("maths/") && name !== "maths/books.json" && !tables.has(name))
			problems.push(`${name} is no table its books' record names`);

	return { problems: [...problems, ...checked.check.problems], checked };
}

/**
 * Installs a package into the folder `into`, in place of whatever is there. `open` gives
 * the package's bytes. `expect`, where a site knows what it asked for, is the game and
 * version the package must be. Throws, with nothing put in place, at a package that is not
 * whole, is not what its record says, or does not pass its checks.
 */
export async function installPackage(
	open: () => Promise<Readable> | Readable,
	into: string,
	options: {
		expect?: { slug: string; version: string };
		/** The most it may come to, unpacked. */
		mostBytes?: number;
	} = {}
): Promise<InstalledPackage> {
	const coming = `${into}.coming`;
	const most = options.mostBytes ?? MOST_BYTES;
	/** Why the package is refused. */
	const refused = (why: string) => new Error(`The package is refused: ${why}`);

	rmSync(coming, { recursive: true, force: true });
	mkdirSync(coming, { recursive: true });

	try {
		const source = await open();
		const unzipped = createGunzip();
		// Whatever stops either end stops the other; why is told by the reading below.
		void pipeline(source, unzipped).catch(() => {});

		let held: PackageRecord | undefined;
		const toCome = new Set<string>();
		let bytes = 0;

		try {
			for await (const entry of tarEntries(unzipped)) {
				if (!held) {
					if (entry.name !== PACKAGE_RECORD)
						throw refused(
							`it begins with ${entry.name}, not ${PACKAGE_RECORD}.`
						);
					if (entry.size > MOST_RECORD_BYTES)
						throw refused(`its ${PACKAGE_RECORD} is too large.`);

					const parts: Buffer[] = [];
					for await (const part of entry.bytes()) parts.push(part);

					const parsed = valibot.safeParse(
						record,
						JSON.parse(Buffer.concat(parts).toString("utf8"))
					);
					if (!parsed.success)
						throw refused(
							`its ${PACKAGE_RECORD} is not one: ${parsed.issues[0].message}`
						);

					held = parsed.output;

					const { expect } = options;
					if (
						expect &&
						(held.slug !== expect.slug || held.version !== expect.version)
					)
						throw refused(
							`it is ${held.slug} at ${held.version}, not ${expect.slug} at ${expect.version}.`
						);

					for (const name of Object.keys(held.files)) {
						if (!belongs(name))
							throw refused(
								`${name} is not a place a file of a package may have.`
							);

						toCome.add(name);
					}
					for (const name of REQUIRED)
						if (!toCome.has(name)) throw refused(`it has no ${name}.`);

					writeFileSync(join(coming, PACKAGE_RECORD), Buffer.concat(parts));
					continue;
				}

				const said = held.files[entry.name];
				if (!said || !toCome.delete(entry.name))
					throw refused(
						`it holds ${entry.name}, which its record does not name.`
					);
				if (entry.size !== said.size)
					throw refused(`${entry.name} is not the size its record names.`);

				bytes += entry.size;
				if (bytes > most) throw refused("it is too large.");

				// Written as it arrives, and read through once for its digest on the way.
				const hash = createHash("sha256");
				const file = join(coming, entry.name);
				mkdirSync(dirname(file), { recursive: true });
				await pipeline(
					Readable.from(entry.bytes()),
					new Transform({
						transform(part: Buffer, _encoding, done) {
							hash.update(part);
							done(null, part);
						}
					}),
					createWriteStream(file)
				);
				if (hash.digest("hex") !== said.sha256)
					throw refused(`${entry.name} is not the file its record names.`);
			}
		} finally {
			source.destroy();
			unzipped.destroy();
		}

		if (!held) throw refused("it is empty.");
		if (toCome.size > 0)
			throw refused(
				`it has no ${[...toCome].slice(0, 5).join(", ")}${toCome.size > 5 ? `, and ${toCome.size - 5} more` : ""}, which its record names.`
			);

		const { problems, checked } = checkUnpacked(coming, held);
		if (problems.length > 0 || !checked) throw refused(problems.join("; "));

		rmSync(into, { recursive: true, force: true });
		mkdirSync(dirname(into), { recursive: true });
		renameSync(coming, into);

		return { folder: into, record: held, checked };
	} finally {
		rmSync(coming, { recursive: true, force: true });
	}
}

/**
 * What a site lists of a game it has installed, for a studio: its manifest, its guide and
 * what the check of its books found, as an entry of a listing (./listing.ts). Throws if
 * the books did not pass.
 */
export function listingOf(installed: InstalledPackage, studio: string): unknown {
	const { checked, folder } = installed;
	if (!checked.check.passed)
		throw new Error(
			`${checked.game.slug}'s books do not pass the check: ${checked.check.problems.join("; ")}`
		);

	const { slug, name, blurb, category, minStake, maxStake } = checked.game;
	const books: BookListing = {
		game: checked.game,
		tables: checked.books.tables,
		modes: checked.check.modes
	};

	return {
		slug,
		name,
		blurb,
		studio,
		category,
		rtpBp: BOOK_RTP_BP,
		// Rated on ordinary play: the first mode.
		volatility: checked.check.modes[0].volatility,
		...(minStake !== undefined ? { minStake } : {}),
		...(maxStake !== undefined ? { maxStake } : {}),
		...(checked.game.steps !== undefined ? { steps: checked.game.steps } : {}),
		shapes: checked.game.shapes ?? ["wide"],
		keepsProgress: checked.game.counters !== undefined,
		guide: JSON.parse(readFileSync(join(folder, "guide.json"), "utf8")),
		books
	};
}

/** Whether a folder holds a package installed whole: its record, and the files it requires. */
export function isInstalled(folder: string): boolean {
	return (
		existsSync(join(folder, PACKAGE_RECORD)) &&
		REQUIRED.every(
			(name) =>
				existsSync(join(folder, name)) && statSync(join(folder, name)).isFile()
		)
	);
}
