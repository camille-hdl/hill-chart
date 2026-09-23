import { readFileSync } from "node:fs";

export type Scope = { name: string; position: number };
export type HillChart = { title?: string; subtitle?: string; scopes: Scope[] };
export type Theme = {
	background: string; // "#rrggbb" | "#rgb" | "transparent"
	ink: string;
	muted: string;
	dot: string;
	axis: string; // "#rrggbb" | "#rgb"
	fontSize: number;
	width: number;
	seed: number;
};

/** Invalid data or theme. `field` is a path such as `scopes[2].position`. */
export class HillChartError extends Error {
	readonly field: string;

	constructor(field: string, reason: string) {
		super(`${field}: ${reason}`);
		this.name = "HillChartError";
		this.field = field;
	}
}

/** Characters left after normalization that XML 1.0 forbids: controls, U+FFFE, U+FFFF and lone surrogates. */
const FORBIDDEN_IN_XML = /[\p{Cc}\p{Cs}\uFFFE\uFFFF]/u;

/** The most characters a title, subtitle or name may have: enough for about 7 lines of a name, and a bounded heading. */
const MAX_TEXT_LENGTH = 200;

/** The most scopes a hill chart may have, which keeps placement, quadratic in their number, to a few milliseconds. */
const MAX_SCOPES = 100;

const DEFAULT_THEME: Theme = JSON.parse(
	readFileSync(new URL("../default-theme.json", import.meta.url), "utf8"),
);

/** How to read each theme key, from a value and its field. */
const THEME_READERS: {
	[K in keyof Theme]: (value: unknown, field: string) => Theme[K];
} = {
	background: (value, field) =>
		value === "transparent"
			? value
			: readColor(value, field, ' or "transparent"'),
	ink: readColor,
	muted: readColor,
	dot: readColor,
	axis: readColor,
	fontSize: (value, field) => readNumber(value, field, 6, 96),
	width: (value, field) => readNumber(value, field, 200, 4000),
	seed: readSeed,
};

/** Validates `data` and returns it as a new `HillChart`, or throws `HillChartError`. */
export function readChart(data: unknown): HillChart {
	if (!isObject(data)) {
		throw new HillChartError(
			"(root)",
			'expected an object with a "scopes" array',
		);
	}
	const chart: Partial<HillChart> = {};
	for (const [key, value] of presentEntries(data)) {
		if (key === "title" || key === "subtitle") {
			chart[key] = readText(value, key, "must not be empty (omit it instead)");
		} else if (key === "scopes") {
			chart.scopes = readScopes(value);
		} else {
			throw new HillChartError(
				keyPath("", key),
				'unknown key; a hill chart has only "title", "subtitle" and "scopes"',
			);
		}
	}
	if (chart.scopes === undefined) {
		throw new HillChartError("scopes", "required");
	}
	return { ...chart, scopes: chart.scopes };
}

/** Returns the theme to draw with: the default theme when `theme` is undefined. */
export function readTheme(theme: unknown): Theme {
	const read: Theme = { ...DEFAULT_THEME };
	if (theme === undefined) return read;
	if (!isObject(theme)) throw new HillChartError("theme", "expected an object");
	for (const [key, value] of presentEntries(theme)) {
		if (!Object.hasOwn(THEME_READERS, key)) {
			throw new HillChartError(
				keyPath("theme", key),
				'unknown key; a theme has only "background", "ink", "muted", "dot", "axis", "fontSize", "width" and "seed"',
			);
		}
		readThemeKey(read, key as keyof Theme, value);
	}
	return read;
}

/** Sets `read[key]` to `value`, once valid. */
function readThemeKey<K extends keyof Theme>(
	read: Theme,
	key: K,
	value: unknown,
): void {
	read[key] = THEME_READERS[key](value, keyPath("theme", key));
}

function readScopes(scopes: unknown): Scope[] {
	if (!Array.isArray(scopes)) {
		throw new HillChartError("scopes", "expected an array");
	}
	if (scopes.length > MAX_SCOPES) {
		throw new HillChartError(
			"scopes",
			`must have at most ${MAX_SCOPES} scopes, got ${scopes.length}`,
		);
	}
	const names = new Map<string, string>(); // name → field of the scope it names
	// Array.from visits holes too, as undefined, where map would skip them.
	return Array.from(scopes, (scope, i) =>
		readScope(scope, `scopes[${i}]`, names),
	);
}

function readScope(
	scope: unknown,
	field: string,
	names: Map<string, string>,
): Scope {
	if (!isObject(scope)) {
		throw new HillChartError(
			field,
			'expected an object with "name" and "position"',
		);
	}
	const read: Partial<Scope> = {};
	for (const [key, value] of presentEntries(scope)) {
		if (key === "name") {
			read.name = readName(value, field, names);
		} else if (key === "position") {
			read.position = readNumber(value, `${field}.position`, 0, 1);
		} else {
			throw new HillChartError(
				keyPath(field, key),
				'unknown key; a scope has only "name" and "position"',
			);
		}
	}
	if (read.name === undefined) {
		throw new HillChartError(`${field}.name`, "required");
	}
	if (read.position === undefined) {
		throw new HillChartError(`${field}.position`, "required");
	}
	return { name: read.name, position: read.position };
}

/** Reads the name of the scope at `field`, unique among the `names` read so far. */
function readName(
	name: unknown,
	field: string,
	names: Map<string, string>,
): string {
	const text = readText(name, `${field}.name`, "must not be empty");
	const other = names.get(text);
	if (other !== undefined) {
		throw new HillChartError(
			`${field}.name`,
			`duplicate name ${JSON.stringify(text)} (same as ${other})`,
		);
	}
	names.set(text, field);
	return text;
}

/** Reads a finite number from `min` to `max`, both included. */
function readNumber(
	number: unknown,
	field: string,
	min: number,
	max: number,
): number {
	if (
		typeof number !== "number" ||
		!Number.isFinite(number) ||
		number < min ||
		number > max
	) {
		throw new HillChartError(
			field,
			`must be a number from ${min} to ${max}, got ${show(number)}`,
		);
	}
	return number;
}

/** Reads the Wobble's seed: an unsigned 32-bit integer. */
function readSeed(seed: unknown, field: string): number {
	const max = 2 ** 32 - 1;
	if (
		typeof seed !== "number" ||
		!Number.isInteger(seed) ||
		seed < 0 ||
		seed > max
	) {
		throw new HillChartError(
			field,
			`must be an integer from 0 to ${max}, got ${show(seed)}`,
		);
	}
	return seed;
}

/** Reads a `#rgb` or `#rrggbb` color, lowercased. `orElse` names the other accepted values in the message. */
function readColor(color: unknown, field: string, orElse = ""): string {
	if (typeof color !== "string" || !/^#([\da-f]{3}|[\da-f]{6})$/i.test(color)) {
		throw new HillChartError(
			field,
			`expected a hex color like "#990f3d"${orElse}, got ${show(color)}`,
		);
	}
	return color.toLowerCase();
}

/** Reads text as it will be drawn: in NFC, every run of whitespace as one space, trimmed, not empty and not too long. */
function readText(text: unknown, field: string, whenEmpty: string): string {
	if (typeof text !== "string") {
		throw new HillChartError(field, "expected a string");
	}
	const normalized = text.normalize("NFC").replace(/\s+/g, " ").trim();
	if (normalized === "") throw new HillChartError(field, whenEmpty);
	let length = 0;
	for (const _ of normalized) length++; // in code points, as drawn, without allocating
	if (length > MAX_TEXT_LENGTH) {
		throw new HillChartError(
			field,
			`must be at most ${MAX_TEXT_LENGTH} characters, got ${length}`,
		);
	}
	const control = normalized.match(FORBIDDEN_IN_XML)?.[0];
	if (control !== undefined) {
		throw new HillChartError(
			field,
			`contains control character ${codePoint(control)}`,
		);
	}
	return normalized;
}

/** The keys of `object` in document order, skipping those set to `undefined` as if absent. */
function presentEntries(object: Record<string, unknown>): [string, unknown][] {
	return Object.entries(object).filter(([, value]) => value !== undefined);
}

/** A plain object, as `JSON.parse` makes: no array, `Map`, `Date` or class instance. */
function isObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

/** The field path of `key` under `parent`: `scopes[0].label`, or `scopes[0]["a.b"]` for a key a dot would garble. */
function keyPath(parent: string, key: string): string {
	if (key === "" || /[.[]/.test(key))
		return `${parent}[${JSON.stringify(key)}]`;
	return parent === "" ? key : `${parent}.${key}`;
}

/** `U+0007` for the bell character. */
export function codePoint(character: string): string {
	const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase();
	return `U+${hex.padStart(4, "0")}`;
}

/** Shows a JSON value as the user wrote it, e.g. `1.2`, `"0.5"`, `NaN`. */
function show(value: unknown): string {
	return typeof value === "number"
		? String(value)
		: (JSON.stringify(value) ?? String(value));
}
