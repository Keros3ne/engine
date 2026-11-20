/**
 * A game as the one file it travels in (./game-package.ts): that what is packed is what is
 * installed, held to its own record, and that a package that is not whole, or not what it
 * says, or not a game a site can hold, is refused with nothing left behind.
 *
 * Author: dwclake
 * Created: 2026-11-20
 */

import { execFileSync } from "node:child_process";
import {
	createReadStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	PACKAGE_RECORD,
	fileDigest,
	installPackage,
	isInstalled,
	listingOf,
	packedName,
	peekPackage,
	readPackageRecord,
	writePackage,
	type PackageRecord
} from "./game-package.ts";
import { listedEntry } from "./listing.ts";
import { PROTOCOL } from "./protocol.ts";
import { tarBytes, tarEntries } from "./tar.ts";
import { FIXTURE, PACKAGE_FILES, writePackageFixture } from "./test/book-fixture.ts";

const scratch = mkdtempSync(join(tmpdir(), "keros3ne-package-"));
const made = join(scratch, "made");
const out = join(scratch, "out");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const ABOUT = { slug: FIXTURE, version: "1.0.0", sdk: "9.9.9", protocol: PROTOCOL };
const NAME = "book-fixture-1.0.0.tar.gz";

/** The fixture's files as a package is given them. */
const files = (from = made) =>
	PACKAGE_FILES.map((name) => ({ name, file: join(from, name) }));

/** A package's bytes, from a file of them. */
const from = (file: string) => () => createReadStream(file);

/**
 * The package with each of its files as `change` gives it (`null` leaves one out), and its
 * record as `rewrite` gives it: what a package that is not what it says would be.
 */
async function repacked(
	change: (name: string, bytes: Buffer) => Buffer | null = (_name, bytes) => bytes,
	rewrite: (record: PackageRecord) => unknown = (record) => record,
	more: Record<string, string> = {}
): Promise<() => Readable> {
	const entries: { name: string; size: number; bytes: () => Buffer[] }[] = [];

	for await (const entry of tarEntries(
		Readable.from([gunzipSync(readFileSync(join(out, NAME)))])
	)) {
		const parts: Buffer[] = [];
		for await (const part of entry.bytes()) parts.push(part);

		const read = Buffer.concat(parts);
		const bytes =
			entry.name === PACKAGE_RECORD
				? Buffer.from(JSON.stringify(rewrite(JSON.parse(read.toString("utf8")))))
				: change(entry.name, read);
		if (bytes)
			entries.push({ name: entry.name, size: bytes.length, bytes: () => [bytes] });
	}
	for (const [name, text] of Object.entries(more))
		entries.push({
			name,
			size: Buffer.byteLength(text),
			bytes: () => [Buffer.from(text)]
		});

	const parts: Buffer[] = [];
	for await (const part of tarBytes(entries)) parts.push(part);

	return () => Readable.from([gzipSync(Buffer.concat(parts))]);
}

/** Installing a package into a folder of its own, which must come to nothing. */
async function refusedFor(name: string, open: () => Readable, why: RegExp) {
	const into = join(scratch, "refused", name);

	await expect(installPackage(open, into)).rejects.toThrow(why);
	expect(existsSync(into)).toBe(false);
	expect(existsSync(`${into}.coming`)).toBe(false);
}

beforeAll(async () => {
	writePackageFixture(made);
	await writePackage(out, ABOUT, files());
});

describe("a game, packed", () => {
	it("is one file named for the game and its version, which says what it holds", async () => {
		expect(packedName(FIXTURE, "1.0.0")).toBe(NAME);
		expect(readdirSync(out)).toEqual([NAME]);

		const listed = execFileSync("tar", ["-tzf", join(out, NAME)], {
			encoding: "utf8"
		})
			.trim()
			.split("\n");
		// Its record first, then its files as they were given.
		expect(listed).toEqual([PACKAGE_RECORD, ...PACKAGE_FILES]);

		const into = join(scratch, "by-hand");
		mkdirSync(into);
		execFileSync("tar", ["-xzf", join(out, NAME), "-C", into]);

		const record = JSON.parse(readFileSync(join(into, PACKAGE_RECORD), "utf8"));
		expect(record).toMatchObject({ format: 1, ...ABOUT });
		expect(Object.keys(record.files)).toEqual(PACKAGE_FILES);
		expect(record.files["client/index.html"]).toEqual(
			await fileDigest(join(made, "client", "index.html"))
		);
	});

	it("says what it is without being installed", async () => {
		const { record, game } = await peekPackage(from(join(out, NAME)));

		expect(record).toMatchObject(ABOUT);
		expect(game).toMatchObject({ slug: FIXTURE, version: "1.0.0" });
		await expect(
			peekPackage(() => Readable.from([gzipSync("not a game")]))
		).rejects.toThrow();
	});

	it("is the same file whenever the same game is packed, and says its own digest", async () => {
		const again = join(scratch, "again");
		const packed = await writePackage(again, ABOUT, files());

		expect(readFileSync(join(again, NAME))).toEqual(readFileSync(join(out, NAME)));
		expect(packed).toEqual({ name: NAME, ...(await fileDigest(join(out, NAME))) });
	});

	it("may hold assets, and holds nothing outside its folders", async () => {
		const assets = join(scratch, "with-assets");
		writeFileSync(join(scratch, "theme.ogg"), "sound");

		await writePackage(assets, ABOUT, [
			...files(),
			{ name: "assets/sound/theme.ogg", file: join(scratch, "theme.ogg") }
		]);
		const installed = await installPackage(
			from(join(assets, NAME)),
			join(scratch, "sounding")
		);
		expect(
			readFileSync(join(installed.folder, "assets", "sound", "theme.ogg"), "utf8")
		).toBe("sound");

		const elsewhere = [
			...files(),
			{ name: "notes.txt", file: join(scratch, "theme.ogg") }
		];
		await expect(writePackage(assets, ABOUT, elsewhere)).rejects.toThrow(
			/not a place a file of a package may have/
		);
		await expect(writePackage(assets, ABOUT, files().slice(1))).rejects.toThrow(
			/has a game\.json/
		);
	});
});

describe("a package, installed", () => {
	it("is the game that was packed, its books checked, and is listed from what was installed", async () => {
		const into = join(scratch, "site", FIXTURE, "1.0.0");
		const installed = await installPackage(from(join(out, NAME)), into, {
			expect: { slug: FIXTURE, version: "1.0.0" }
		});

		expect(installed.record).toMatchObject(ABOUT);
		expect(readPackageRecord(into)).toEqual(installed.record);
		expect(installed.checked.check.passed).toBe(true);
		expect(isInstalled(into)).toBe(true);
		for (const name of PACKAGE_FILES)
			expect(readFileSync(join(into, name))).toEqual(
				readFileSync(join(made, name))
			);

		const game = listedEntry(
			listingOf(installed, "st-fixture"),
			"the test",
			"st-fixture",
			FIXTURE
		);
		expect(game).toMatchObject({
			slug: FIXTURE,
			version: "1.0.0",
			studio: "st-fixture",
			keepsProgress: true,
			rtpBp: 9_600
		});
		expect(Object.keys(game.books.tables)).toContain("gem-pour");

		// Installed again, it takes the place of what was there.
		writeFileSync(join(into, "stray.txt"), "left behind");
		await installPackage(from(join(out, NAME)), into);
		expect(existsSync(join(into, "stray.txt"))).toBe(false);
	});

	it("is refused when it is not the game or the version asked for", async () => {
		const into = join(scratch, "refused", "other");

		await expect(
			installPackage(from(join(out, NAME)), into, {
				expect: { slug: FIXTURE, version: "1.0.1" }
			})
		).rejects.toThrow(/is book-fixture at 1\.0\.0, not book-fixture at 1\.0\.1/);
		expect(existsSync(into)).toBe(false);
	});

	it("is refused when a file is not the one its record names, is missing, or is not on it", async () => {
		await refusedFor(
			"changed",
			await repacked((name, bytes) =>
				name === "client/index.html"
					? Buffer.from("<script>alert(1)</script>")
					: bytes
			),
			/client\/index\.html is not the size its record names/
		);
		await refusedFor(
			"swapped",
			await repacked((name, bytes) =>
				name === "client/_app/game.js"
					? Buffer.from("export const game = 2;")
					: bytes
			),
			/client\/_app\/game\.js is not the file its record names/
		);
		await refusedFor(
			"missing",
			await repacked((name, bytes) =>
				name === "maths/gem-pour.rows" ? null : bytes
			),
			/has no maths\/gem-pour\.rows, which its record names/
		);
		await refusedFor(
			"extra",
			await repacked(undefined, undefined, { "client/more.js": "more" }),
			/holds client\/more\.js, which its record does not name/
		);
		await refusedFor(
			"outside",
			await repacked(undefined, (record) => ({
				...record,
				files: { ...record.files, "notes.txt": record.files["card.svg"] }
			})),
			/notes\.txt is not a place a file of a package may have/
		);
	});

	it("is refused when it is no package, or its record is not one", async () => {
		await refusedFor("junk", () => Readable.from([gzipSync("not a game")]), /./);
		await refusedFor("not-gzip", () => Readable.from([Buffer.from("not gzip")]), /./);
		await refusedFor(
			"no-record",
			await repacked(undefined, (record) => ({ ...record, format: 2 })),
			/its release\.json is not one/
		);
		await refusedFor(
			"no-card",
			await repacked(
				(name, bytes) => (name === "card.svg" ? null : bytes),
				({ files: { "card.svg": _card, ...rest }, ...record }) => ({
					...record,
					files: rest
				})
			),
			/it has no card\.svg/
		);
	});

	it("is refused when it is not a game this site can hold", async () => {
		await refusedFor(
			"protocol",
			await repacked(undefined, (record) => ({
				...record,
				protocol: "keros3ne-game/999"
			})),
			/speaks keros3ne-game\/999, and this site speaks/
		);
		await refusedFor(
			"version",
			await repacked(undefined, (record) => ({ ...record, version: "2.0.0" })),
			/game\.json is of book-fixture at 1\.0\.0, and the package says book-fixture at 2\.0\.0/
		);

		// Files of a kind no game is made of, and a table its books do not name: each on the
		// record, with its true size and digest, and refused all the same.
		writeFileSync(join(scratch, "stray"), "MZ");
		const said = await fileDigest(join(scratch, "stray"));

		await refusedFor(
			"kind",
			await repacked(
				undefined,
				(record) => ({
					...record,
					files: { ...record.files, "client/tool.exe": said }
				}),
				{ "client/tool.exe": "MZ" }
			),
			/client\/tool\.exe is a kind of file no game is made of/
		);
		await refusedFor(
			"table",
			await repacked(
				undefined,
				(record) => ({
					...record,
					files: { ...record.files, "maths/more.rows": said }
				}),
				{ "maths/more.rows": "MZ" }
			),
			/maths\/more\.rows is no table its books' record names/
		);
	});

	it("is refused when its books are not the books their record names", async () => {
		// Another table's rows under this one's name: well formed, on the package's record,
		// and not what the books' own record says.
		const other = readFileSync(join(made, "maths", "bought.rows"));
		writeFileSync(join(scratch, "other.rows"), other);
		const said = await fileDigest(join(scratch, "other.rows"));

		await refusedFor(
			"books",
			await repacked(
				(name, bytes) => (name === "maths/spin.rows" ? other : bytes),
				(record) => ({
					...record,
					files: { ...record.files, "maths/spin.rows": said }
				})
			),
			/./
		);
	});
});
