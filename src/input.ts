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

const DEFAULT_THEME: Theme = JSON.parse(
	readFileSync(new URL("../default-theme.json", import.meta.url), "utf8"),
);

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
				key,
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
	if (theme !== undefined) {
		throw new HillChartError("theme", "custom themes are not supported yet");
	}
	return { ...DEFAULT_THEME };
}

function readScopes(scopes: unknown): Scope[] {
	if (!Array.isArray(scopes)) {
		throw new HillChartError("scopes", "expected an array");
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
			read.position = readPosition(value, `${field}.position`);
		} else {
			throw new HillChartError(
				`${field}.${key}`,
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

function readPosition(position: unknown, field: string): number {
	if (
		typeof position !== "number" ||
		!Number.isFinite(position) ||
		position < 0 ||
		position > 1
	) {
		throw new HillChartError(
			field,
			`must be a number from 0 to 1, got ${show(position)}`,
		);
	}
	return position;
}

/** Reads text as it will be drawn: in NFC, every run of whitespace as one space, trimmed, and not empty. */
function readText(text: unknown, field: string, whenEmpty: string): string {
	if (typeof text !== "string") {
		throw new HillChartError(field, "expected a string");
	}
	const normalized = text.normalize("NFC").replace(/\s+/g, " ").trim();
	if (normalized === "") throw new HillChartError(field, whenEmpty);
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

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `U+0007` for the bell character. */
function codePoint(character: string): string {
	const hex = (character.codePointAt(0) ?? 0).toString(16).toUpperCase();
	return `U+${hex.padStart(4, "0")}`;
}

/** Shows a JSON value as the user wrote it, e.g. `1.2`, `"0.5"`, `NaN`. */
function show(value: unknown): string {
	return typeof value === "number"
		? String(value)
		: (JSON.stringify(value) ?? String(value));
}
