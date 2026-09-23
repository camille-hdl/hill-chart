import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { renderSvg } from "../src/index.ts";
import {
	type HillChart,
	HillChartError,
	readChart,
	readTheme,
	type Theme,
} from "../src/input.ts";

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
}

/** `count` valid scopes, named `Scope 1` to `Scope <count>`. */
function scopes(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		name: `Scope ${i + 1}`,
		position: 0.3,
	}));
}

describe("readChart", () => {
	const valid: [string, unknown, HillChart][] = [
		["no title and no scopes", { scopes: [] }, { scopes: [] }],
		[
			"a subtitle",
			{ subtitle: "Week 12", scopes: [] },
			{ subtitle: "Week 12", scopes: [] },
		],
		[
			"runs of whitespace and line breaks",
			{
				title: "  Community\tgarden\n\nplanner ",
				subtitle: "\nWeek  12\r\n",
				scopes: [{ name: " Plot\u00a0 map\n", position: 0.2 }],
			},
			{
				title: "Community garden planner",
				subtitle: "Week 12",
				scopes: [{ name: "Plot map", position: 0.2 }],
			},
		],
		[
			"decomposed accents",
			{
				title: "Potager partage\u0301",
				subtitle: "Re\u0301colte",
				scopes: [
					{ name: "Carte des parcelles e\u0301te\u0301", position: 0.2 },
				],
			},
			{
				title: "Potager partagé",
				subtitle: "Récolte",
				scopes: [{ name: "Carte des parcelles été", position: 0.2 }],
			},
		],
		[
			"positions 0, 0.5 and 1",
			{
				scopes: [
					{ name: "Plot map", position: 0 },
					{ name: "Harvest log", position: 0.5 },
					{ name: "Login", position: 1 },
				],
			},
			{
				scopes: [
					{ name: "Plot map", position: 0 },
					{ name: "Harvest log", position: 0.5 },
					{ name: "Login", position: 1 },
				],
			},
		],
		[
			"two scopes at the same position",
			{
				scopes: [
					{ name: "Plot map", position: 0.3 },
					{ name: "Login", position: 0.3 },
				],
			},
			{
				scopes: [
					{ name: "Plot map", position: 0.3 },
					{ name: "Login", position: 0.3 },
				],
			},
		],
		[
			"a character outside the Basic Multilingual Plane",
			{ scopes: [{ name: "Seed catalogue \u{1f331}", position: 0.3 }] },
			{ scopes: [{ name: "Seed catalogue \u{1f331}", position: 0.3 }] },
		],
		["100 scopes", { scopes: scopes(100) }, { scopes: scopes(100) }],
		[
			"texts of 200 characters",
			{
				title: "W".repeat(200),
				subtitle: "W".repeat(200),
				scopes: [{ name: "W".repeat(200), position: 0.3 }],
			},
			{
				title: "W".repeat(200),
				subtitle: "W".repeat(200),
				scopes: [{ name: "W".repeat(200), position: 0.3 }],
			},
		],
		[
			"a name of 200 characters outside the Basic Multilingual Plane, counted as characters",
			{ scopes: [{ name: "\u{1f331}".repeat(200), position: 0.3 }] },
			{ scopes: [{ name: "\u{1f331}".repeat(200), position: 0.3 }] },
		],
		[
			"a subtitle of 200 characters once normalized",
			{ subtitle: ` ${"e\u0301".repeat(200)}\n`, scopes: [] },
			{ subtitle: "\u00e9".repeat(200), scopes: [] },
		],
		[
			"objects without a prototype",
			Object.assign(Object.create(null), {
				scopes: [
					Object.assign(Object.create(null), { name: "Login", position: 1 }),
				],
			}),
			{ scopes: [{ name: "Login", position: 1 }] },
		],
		[
			"keys set to undefined, as if absent",
			{
				title: undefined,
				scopes: [{ name: "Plot map", position: 0.3, color: undefined }],
			},
			{ scopes: [{ name: "Plot map", position: 0.3 }] },
		],
	];

	for (const [situation, data, chart] of valid) {
		test(`accepts ${situation}`, () => {
			assert.deepEqual(readChart(data), chart);
		});
	}

	test("returns a new object rather than its argument", () => {
		const data = { scopes: [{ name: "Plot map", position: 0.2 }] };
		const chart = readChart(data);
		assert.notEqual(chart, data);
		assert.notEqual(chart.scopes, data.scopes);
		assert.notEqual(chart.scopes[0], data.scopes[0]);
	});

	test("normalizes a deep-frozen input without touching it", () => {
		const data = deepFreeze({
			title: " Community  garden planner ",
			scopes: [{ name: "Plot\nmap", position: 0.2 }],
		});
		assert.deepEqual(readChart(data), {
			title: "Community garden planner",
			scopes: [{ name: "Plot map", position: 0.2 }],
		});
		assert.equal(data.scopes[0].name, "Plot\nmap");
	});

	const invalid: [string, unknown, string, RegExp][] = [
		["a non-object root", [], "(root)", /expected an object/],
		["a null root", null, "(root)", /expected an object/],
		["a missing scopes array", {}, "scopes", /required/],
		["scopes that are not an array", { scopes: {} }, "scopes", /array/],
		["a scope that is not an object", { scopes: [1] }, "scopes[0]", /object/],
		[
			"101 scopes",
			{ scopes: scopes(101) },
			"scopes",
			/^scopes: must have at most 100 scopes, got 101$/,
		],
		[
			"101 scopes, before an invalid scope further in the array",
			{ scopes: [...scopes(100), { name: "", position: 2 }] },
			"scopes",
			/got 101$/,
		],
		[
			"101 scopes before an invalid title, in document order",
			{ scopes: scopes(101), title: 1 },
			"scopes",
			/got 101$/,
		],
		[
			"an empty name",
			{ scopes: [{ name: "", position: 0.5 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: must not be empty$/,
		],
		[
			"a name made of whitespace only",
			{ scopes: [{ name: " \n\t ", position: 0.5 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: must not be empty$/,
		],
		[
			"a non-string name",
			{ scopes: [{ name: 3, position: 0.5 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: expected a string$/,
		],
		[
			"a position above 1",
			{ scopes: [{ name: "A", position: 1.2 }] },
			"scopes[0].position",
			/must be a number from 0 to 1, got 1\.2$/,
		],
		[
			"a negative position",
			{ scopes: [{ name: "A", position: -0.1 }] },
			"scopes[0].position",
			/got -0\.1$/,
		],
		[
			"a position given as a string",
			{ scopes: [{ name: "A", position: "0.5" }] },
			"scopes[0].position",
			/got "0\.5"$/,
		],
		[
			"a NaN position",
			{ scopes: [{ name: "A", position: Number.NaN }] },
			"scopes[0].position",
			/got NaN$/,
		],
		[
			"an infinite position",
			{ scopes: [{ name: "A", position: Number.POSITIVE_INFINITY }] },
			"scopes[0].position",
			/got Infinity$/,
		],
		[
			"a missing position",
			{ scopes: [{ name: "A" }] },
			"scopes[0].position",
			/^scopes\[0\]\.position: required$/,
		],
		[
			"a missing name",
			{ scopes: [{ position: 0.5 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: required$/,
		],
		[
			"an error in a later scope",
			{
				scopes: [
					{ name: "A", position: 0.1 },
					{ name: "B", position: 0.2 },
					{ name: "C", position: 2 },
				],
			},
			"scopes[2].position",
			/got 2$/,
		],
		["a non-string title", { title: 1, scopes: [] }, "title", /string/],
		[
			"an empty title",
			{ title: "", scopes: [] },
			"title",
			/^title: must not be empty \(omit it instead\)$/,
		],
		[
			"a title of 201 characters",
			{ title: "W".repeat(201), scopes: [] },
			"title",
			/^title: must be at most 200 characters, got 201$/,
		],
		[
			"a subtitle of 201 characters",
			{ subtitle: "W".repeat(201), scopes: [] },
			"subtitle",
			/^subtitle: must be at most 200 characters, got 201$/,
		],
		[
			"a name of 201 characters outside the Basic Multilingual Plane",
			{ scopes: [{ name: "\u{1f331}".repeat(201), position: 0.3 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: must be at most 200 characters, got 201$/,
		],
		[
			"a non-string subtitle",
			{ subtitle: ["Week 12"], scopes: [] },
			"subtitle",
			/^subtitle: expected a string$/,
		],
		[
			"a subtitle made of whitespace only",
			{ subtitle: "  ", scopes: [] },
			"subtitle",
			/^subtitle: must not be empty \(omit it instead\)$/,
		],
		[
			"a hole in the scopes array",
			{
				// biome-ignore lint/suspicious/noSparseArray: the hole is the case under test
				scopes: [{ name: "A", position: 0.1 }, , { name: "C", position: 0.3 }],
			},
			"scopes[1]",
			/object/,
		],
		[
			"an invalid title before invalid scopes",
			{ title: 1, scopes: [{ name: "" }] },
			"title",
			/string/,
		],
		[
			"a control character in a name",
			{ scopes: [{ name: "A\u0007", position: 0.1 }] },
			"scopes[0].name",
			/^scopes\[0\]\.name: contains control character U\+0007$/,
		],
		[
			"a C0 control character that is not whitespace",
			{ scopes: [{ name: "A\u001fB", position: 0.1 }] },
			"scopes[0].name",
			/U\+001F$/,
		],
		[
			"a C1 control character in a title",
			{ title: "Week\u0085 12", scopes: [] },
			"title",
			/^title: contains control character U\+0085$/,
		],
		[
			"a noncharacter in a subtitle",
			{ subtitle: "Week 12\uffff", scopes: [] },
			"subtitle",
			/U\+FFFF$/,
		],
		[
			"a lone surrogate in a name",
			{ scopes: [{ name: "Plot \ud83c map", position: 0.1 }] },
			"scopes[0].name",
			/U\+D83C$/,
		],
		[
			"two names equal after normalization",
			{
				scopes: [
					{ name: "Reply", position: 0.1 },
					{ name: " Reply ", position: 0.2 },
				],
			},
			"scopes[1].name",
			/^scopes\[1\]\.name: duplicate name "Reply" \(same as scopes\[0\]\)$/,
		],
		[
			"two names equal in NFC",
			{
				scopes: [
					{ name: "Plot map", position: 0.1 },
					{ name: "R\u00e9colte", position: 0.2 },
					{ name: "Re\u0301colte", position: 0.3 },
				],
			},
			"scopes[2].name",
			/duplicate name "R\u00e9colte" \(same as scopes\[1\]\)$/,
		],
		[
			"a duplicate name before an invalid position of the same scope",
			{
				scopes: [
					{ name: "A", position: 0.1 },
					{ name: "A", position: 2 },
				],
			},
			"scopes[1].name",
			/duplicate name/,
		],
		[
			"invalid scopes before an invalid title, in document order",
			{ scopes: [{ name: "" }], title: 1 },
			"scopes[0].name",
			/empty/,
		],
		[
			"an invalid position before an invalid name, in document order",
			{ scopes: [{ position: 2, name: "" }] },
			"scopes[0].position",
			/got 2$/,
		],
		[
			"an invalid subtitle rather than missing scopes, reported last",
			{ subtitle: "" },
			"subtitle",
			/empty/,
		],
		[
			"an unknown key rather than missing scopes, reported last",
			{ scope: [] },
			"scope",
			/unknown key/,
		],
		[
			"an empty unknown key at the root",
			{ scopes: [], "": 1 },
			'[""]',
			/^\[""\]: unknown key; a hill chart has only/,
		],
		[
			"an unknown key with a dot at the root",
			{ scopes: [], "scopes.name": 1 },
			'["scopes.name"]',
			/unknown key/,
		],
		[
			"an unknown key with a bracket on a scope",
			{ scopes: [{ name: "A", position: 0.1, "tags[0]": "x" }] },
			'scopes[0]["tags[0]"]',
			/^scopes\[0\]\["tags\[0\]"\]: unknown key; a scope has only/,
		],
		[
			"an empty unknown key on a scope",
			{ scopes: [{ name: "A", position: 0.1, "": "x" }] },
			'scopes[0][""]',
			/unknown key/,
		],
		["a Map root", new Map([["scopes", []]]), "(root)", /expected an object/],
		["a Date root", new Date(0), "(root)", /expected an object/],
		[
			"a class instance as a scope",
			{
				scopes: [
					new (class {
						name = "A";
						position = 0.1;
					})(),
				],
			},
			"scopes[0]",
			/expected an object/,
		],
		[
			"an unknown key at the root",
			{ scopes: [], positon: 0.5 },
			"positon",
			/^positon: unknown key; a hill chart has only "title", "subtitle" and "scopes"$/,
		],
		[
			"a label on a scope",
			{ scopes: [{ label: "A", position: 0.1 }] },
			"scopes[0].label",
			/^scopes\[0\]\.label: unknown key; a scope has only "name" and "position"$/,
		],
		[
			"a color on a scope",
			{ scopes: [{ name: "A", position: 0.1, color: "#f00" }] },
			"scopes[0].color",
			/unknown key/,
		],
	];

	for (const [situation, data, field, reason] of invalid) {
		test(`rejects ${situation} with field ${field}`, () => {
			assert.throws(
				() => readChart(data),
				(error) => {
					assert.ok(error instanceof HillChartError);
					assert.equal(error.field, field);
					assert.ok(error.message.startsWith(`${field}: `), error.message);
					assert.match(error.message, reason);
					return true;
				},
			);
		});
	}
});

describe("messages quoting the input", () => {
	/** A character a terminal could act on: control, format, surrogate, private use, unassigned, U+2028 or U+2029. */
	const unprintable = /[\p{C}\u2028\u2029]/u;
	const osc = "\u001b]0;TITLE\u0007\r";

	const quoting: [string, () => unknown, string][] = [
		[
			"an unknown key at the root",
			() => readChart({ scopes: [], [osc]: 1 }),
			'["\\u001b]0;TITLE\\u0007\\r"]: unknown key',
		],
		[
			"an unknown key on a scope",
			() => readChart({ scopes: [{ name: "A", position: 0.1, [osc]: 1 }] }),
			'scopes[0]["\\u001b]0;TITLE\\u0007\\r"]: unknown key',
		],
		[
			"an unknown key in the theme",
			() => readTheme({ [osc]: 1 }),
			'theme["\\u001b]0;TITLE\\u0007\\r"]: unknown key',
		],
		[
			"an unknown key with a C1 control and a dot",
			() => readChart({ scopes: [], "\u009b31m.": 1 }),
			'["\\u009b31m."]: unknown key',
		],
		[
			"an unknown key with a line separator",
			() => readChart({ scopes: [], "a\u2028b": 1 }),
			'["a\\u2028b"]: unknown key',
		],
		[
			"a position with a C1 control",
			() => readChart({ scopes: [{ name: "A", position: "\u009b31mX" }] }),
			'got "\\u009b31mX"',
		],
		[
			"a color object with a C1 control in a key",
			() => readTheme({ dot: { "\u009b": "#000" } }),
			'got {"\\u009b":"#000"}',
		],
		[
			"a duplicate name with a right-to-left override",
			() =>
				readChart({
					scopes: [
						{ name: "a\u202eb", position: 0.1 },
						{ name: "a\u202eb", position: 0.2 },
					],
				}),
			'duplicate name "a\\u202eb"',
		],
		[
			"a duplicate name with a format character beyond U+FFFF",
			() =>
				readChart({
					scopes: [
						{ name: "a\u{e0001}b", position: 0.1 },
						{ name: "a\u{e0001}b", position: 0.2 },
					],
				}),
			'duplicate name "a\\udb40\\udc01b"',
		],
	];

	for (const [situation, read, escaped] of quoting) {
		test(`escapes ${situation}`, () => {
			assert.throws(read, (error) => {
				assert.ok(error instanceof HillChartError);
				assert.ok(error.message.includes(escaped), error.message);
				assert.doesNotMatch(error.message, unprintable);
				return true;
			});
		});
	}

	const printable: [string, () => unknown, string][] = [
		[
			"an unknown key in another script",
			() => readChart({ scopes: [], İstanbul: 1 }),
			'İstanbul: unknown key; a hill chart has only "title", "subtitle" and "scopes"',
		],
		[
			"a duplicate name in another script",
			() =>
				readChart({
					scopes: [
						{ name: "Łódź", position: 0.1 },
						{ name: "Łódź", position: 0.2 },
					],
				}),
			'scopes[1].name: duplicate name "Łódź" (same as scopes[0])',
		],
	];

	for (const [situation, read, message] of printable) {
		test(`keeps ${situation} as written`, () => {
			assert.throws(read, { name: "HillChartError", message });
		});
	}
});

describe("renderSvg", () => {
	test("throws the HillChartError of invalid data", () => {
		assert.throws(
			() => renderSvg({ scopes: [{ name: "A", position: 70 }] }),
			(error) => {
				assert.ok(error instanceof HillChartError);
				assert.equal(error.field, "scopes[0].position");
				return true;
			},
		);
	});

	test("throws the HillChartError of a title too long", () => {
		assert.throws(
			() => renderSvg({ title: "W".repeat(201), scopes: [] }),
			(error) => {
				assert.ok(error instanceof HillChartError);
				assert.equal(error.field, "title");
				return true;
			},
		);
	});

	test("throws the HillChartError of an invalid theme", () => {
		assert.throws(
			() => renderSvg({ scopes: [] }, { dot: "red" } as Partial<Theme>),
			(error) => {
				assert.ok(error instanceof HillChartError);
				assert.equal(error.field, "theme.dot");
				return true;
			},
		);
	});
});

describe("readTheme", () => {
	test("returns the default theme when no theme is given", () => {
		assert.deepEqual(readTheme(undefined), {
			background: "#fff1e5",
			ink: "#262a33",
			muted: "#6b6259",
			dot: "#990f3d",
			axis: "#b8afa5",
			fontSize: 18,
			width: 960,
			seed: 1,
		});
	});

	test("returns the default theme JSON file of the package", () => {
		const url = new URL("../default-theme.json", import.meta.url);
		assert.deepEqual(
			readTheme(undefined),
			JSON.parse(readFileSync(url, "utf8")),
		);
	});

	test("merges a deep-frozen theme without touching it", () => {
		const theme = deepFreeze({ dot: "#ABC", width: 480 });
		assert.deepEqual(readTheme(theme), {
			...readTheme(undefined),
			dot: "#abc",
			width: 480,
		});
		assert.deepEqual(theme, { dot: "#ABC", width: 480 });
	});

	test("returns a new object rather than its argument", () => {
		const theme = readTheme(undefined);
		assert.notEqual(readTheme(theme), theme);
	});

	test("does not share the default theme between callers", () => {
		const theme = readTheme(undefined);
		theme.width = 200;
		assert.equal(readTheme(undefined).width, 960);
	});

	const valid: [string, unknown, Partial<Theme>][] = [
		["an empty theme", {}, {}],
		[
			"a transparent background",
			{ background: "transparent" },
			{ background: "transparent" },
		],
		["a 6-digit color", { dot: "#1a2b3c" }, { dot: "#1a2b3c" }],
		["a 3-digit color", { ink: "#abc" }, { ink: "#abc" }],
		[
			"an uppercase color, lowercased",
			{ dot: "#ABC", axis: "#A1B2C3" },
			{ dot: "#abc", axis: "#a1b2c3" },
		],
		["a width", { width: 480 }, { width: 480 }],
		[
			"the smallest numbers",
			{ fontSize: 6, width: 200, seed: 0 },
			{ fontSize: 6, width: 200, seed: 0 },
		],
		[
			"the largest numbers",
			{ fontSize: 96, width: 4000, seed: 4294967295 },
			{ fontSize: 96, width: 4000, seed: 4294967295 },
		],
		["a fractional font size", { fontSize: 13.5 }, { fontSize: 13.5 }],
		["a key set to undefined, as absent", { dot: undefined }, {}],
		[
			"every key",
			{
				background: "#000",
				ink: "#ffffff",
				muted: "#999999",
				dot: "#f00",
				axis: "#333",
				fontSize: 24,
				width: 1200,
				seed: 42,
			},
			{
				background: "#000",
				ink: "#ffffff",
				muted: "#999999",
				dot: "#f00",
				axis: "#333",
				fontSize: 24,
				width: 1200,
				seed: 42,
			},
		],
	];

	for (const [situation, theme, changes] of valid) {
		test(`merges ${situation} onto the default theme`, () => {
			assert.deepEqual(readTheme(theme), {
				...readTheme(undefined),
				...changes,
			});
		});
	}

	const invalid: [string, unknown, string, RegExp][] = [
		["an array", [], "theme", /^theme: expected an object$/],
		["null", null, "theme", /^theme: expected an object$/],
		["a string", "#990f3d", "theme", /^theme: expected an object$/],
		[
			"a Map",
			new Map([["dot", "#000"]]),
			"theme",
			/^theme: expected an object$/,
		],
		[
			"a misspelled key",
			{ backgroud: "#fff" },
			"theme.backgroud",
			/^theme\.backgroud: unknown key; a theme has only "background", "ink", "muted", "dot", "axis", "fontSize", "width" and "seed"$/,
		],
		["a font key", { font: "Inter" }, "theme.font", /unknown key/],
		[
			"a key of Object.prototype",
			{ toString: "#000" },
			"theme.toString",
			/unknown key/,
		],
		["an empty key", { "": 1 }, 'theme[""]', /unknown key/],
		[
			"a __proto__ key from JSON",
			JSON.parse('{"__proto__":{}}'),
			"theme.__proto__",
			/unknown key/,
		],
		[
			"a named color",
			{ dot: "red" },
			"theme.dot",
			/^theme\.dot: expected a hex color like "#990f3d", got "red"$/,
		],
		["a 4-digit color", { ink: "#abcd" }, "theme.ink", /got "#abcd"$/],
		["a color without #", { muted: "990f3d" }, "theme.muted", /got "990f3d"$/],
		["a non-hex digit", { axis: "#99g" }, "theme.axis", /got "#99g"$/],
		[
			"an rgb() color",
			{ dot: "rgb(0,0,0)" },
			"theme.dot",
			/got "rgb\(0,0,0\)"$/,
		],
		["a color as a number", { dot: 0x990f3d }, "theme.dot", /got 10030909$/],
		[
			"a transparent dot",
			{ dot: "transparent" },
			"theme.dot",
			/got "transparent"$/,
		],
		["a transparent ink", { ink: "transparent" }, "theme.ink", /hex color/],
		[
			"a named background",
			{ background: "white" },
			"theme.background",
			/^theme\.background: expected a hex color like "#990f3d" or "transparent", got "white"$/,
		],
		[
			"an uppercase transparent",
			{ background: "Transparent" },
			"theme.background",
			/got "Transparent"$/,
		],
		[
			"a width below 200",
			{ width: 100 },
			"theme.width",
			/^theme\.width: must be a number from 200 to 4000, got 100$/,
		],
		[
			"a width above 4000",
			{ width: 4001 },
			"theme.width",
			/from 200 to 4000, got 4001$/,
		],
		[
			"a width as a string",
			{ width: "960" },
			"theme.width",
			/from 200 to 4000, got "960"$/,
		],
		[
			"an infinite width",
			{ width: Number.POSITIVE_INFINITY },
			"theme.width",
			/got Infinity$/,
		],
		[
			"a font size below 6",
			{ fontSize: 5.9 },
			"theme.fontSize",
			/^theme\.fontSize: must be a number from 6 to 96, got 5\.9$/,
		],
		[
			"a font size above 96",
			{ fontSize: 100 },
			"theme.fontSize",
			/from 6 to 96, got 100$/,
		],
		["a NaN font size", { fontSize: Number.NaN }, "theme.fontSize", /got NaN$/],
		[
			"a fractional seed",
			{ seed: 1.5 },
			"theme.seed",
			/^theme\.seed: must be an integer from 0 to 4294967295, got 1\.5$/,
		],
		[
			"a negative seed",
			{ seed: -1 },
			"theme.seed",
			/from 0 to 4294967295, got -1$/,
		],
		[
			"a seed above 2³²−1",
			{ seed: 4294967296 },
			"theme.seed",
			/got 4294967296$/,
		],
		["a seed as a string", { seed: "1" }, "theme.seed", /got "1"$/],
		["a NaN seed", { seed: Number.NaN }, "theme.seed", /got NaN$/],
		[
			"an invalid color after a valid one, in document order",
			{ dot: "#000", ink: "black", axis: "grey" },
			"theme.ink",
			/got "black"$/,
		],
		[
			"an unknown key before an invalid known one, in document order",
			{ colour: "#000", dot: "red" },
			"theme.colour",
			/unknown key/,
		],
	];

	for (const [situation, theme, field, reason] of invalid) {
		test(`rejects ${situation} with field ${field}`, () => {
			assert.throws(
				() => readTheme(theme),
				(error) => {
					assert.ok(error instanceof HillChartError);
					assert.equal(error.field, field);
					assert.match(error.message, reason);
					return true;
				},
			);
		});
	}
});
