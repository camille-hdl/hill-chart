import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderSvg } from "../src/index.ts";
import {
	type HillChart,
	HillChartError,
	readChart,
	readTheme,
} from "../src/input.ts";

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null) {
		for (const child of Object.values(value)) deepFreeze(child);
		Object.freeze(value);
	}
	return value;
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

	test("does not share the default theme between callers", () => {
		const theme = readTheme(undefined);
		theme.width = 200;
		assert.equal(readTheme(undefined).width, 960);
	});

	test("rejects a custom theme, not supported yet", () => {
		assert.throws(() => readTheme({ width: 200 }), {
			name: "HillChartError",
			field: "theme",
		});
	});
});
