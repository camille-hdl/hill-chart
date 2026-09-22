import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HillChartError, readChart, readTheme } from "../src/input.ts";

describe("readChart", () => {
	test("returns the title and the scopes of a valid hill chart", () => {
		const data = {
			title: "Community garden planner",
			scopes: [
				{ name: "Plot map", position: 0 },
				{ name: "Harvest log", position: 0.5 },
				{ name: "Login", position: 1 },
			],
		};
		assert.deepEqual(readChart(data), data);
	});

	test("accepts a hill chart without title and with no scopes", () => {
		assert.deepEqual(readChart({ scopes: [] }), { scopes: [] });
	});

	test("returns a new object rather than its argument", () => {
		const data = { scopes: [{ name: "Plot map", position: 0.2 }] };
		const chart = readChart(data);
		assert.notEqual(chart, data);
		assert.notEqual(chart.scopes, data.scopes);
		assert.notEqual(chart.scopes[0], data.scopes[0]);
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
			/non-empty string/,
		],
		[
			"a non-string name",
			{ scopes: [{ name: 3, position: 0.5 }] },
			"scopes[0].name",
			/non-empty string/,
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
			/must be a number from 0 to 1/,
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
			"an invalid title before invalid scopes",
			{ title: 1, scopes: [{ name: "" }] },
			"title",
			/string/,
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
