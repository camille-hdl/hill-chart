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
	const title =
		data.title === undefined ? {} : { title: readTitle(data.title) };
	return { ...title, scopes: readScopes(data.scopes) };
}

/** Returns the theme to draw with: the default theme when `theme` is undefined. */
export function readTheme(theme: unknown): Theme {
	if (theme !== undefined) {
		throw new HillChartError("theme", "custom themes are not supported yet");
	}
	return { ...DEFAULT_THEME };
}

function readTitle(title: unknown): string {
	if (typeof title !== "string") {
		throw new HillChartError("title", "expected a string");
	}
	return title;
}

function readScopes(scopes: unknown): Scope[] {
	if (scopes === undefined) throw new HillChartError("scopes", "required");
	if (!Array.isArray(scopes)) {
		throw new HillChartError("scopes", "expected an array");
	}
	return scopes.map((scope, i) => readScope(scope, `scopes[${i}]`));
}

function readScope(scope: unknown, field: string): Scope {
	if (!isObject(scope)) {
		throw new HillChartError(
			field,
			'expected an object with "name" and "position"',
		);
	}
	return {
		name: readName(scope.name, `${field}.name`),
		position: readPosition(scope.position, `${field}.position`),
	};
}

function readName(name: unknown, field: string): string {
	if (typeof name !== "string" || name === "") {
		throw new HillChartError(field, "expected a non-empty string");
	}
	return name;
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

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Shows a JSON value as the user wrote it, e.g. `1.2`, `"0.5"`, `NaN`. */
function show(value: unknown): string {
	return typeof value === "number"
		? String(value)
		: (JSON.stringify(value) ?? String(value));
}
