import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HillChart, renderSvg } from "../src/index.ts";

function fixture(name: string): HillChart {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8"));
}

function desc(svg: string): string | undefined {
	return svg.match(/<desc>(.*)<\/desc>/)?.[1];
}

function title(svg: string): string | undefined {
	return svg.match(/<title>(.*)<\/title>/)?.[1];
}

describe("renderSvg", () => {
	for (const name of ["sample", "empty", "extremes"]) {
		test(`draws the ${name} fixture as in its snapshot`, (t) => {
			const path = fileURLToPath(
				new URL(`snapshots/${name}.svg`, import.meta.url),
			);
			t.assert.fileSnapshot(renderSvg(fixture(name)), path, {
				serializers: [(svg) => svg],
			});
		});
	}

	test("starts with a sized, accessible svg element", () => {
		assert.match(
			renderSvg(fixture("sample")),
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="-?\d+\.0 -?\d+\.0 (\d+\.0) (\d+\.0)" width="\1" height="\2" role="img">\n<title>/,
		);
	});

	test("describes every scope with its side and position, sorted by position", () => {
		const svg = renderSvg({
			scopes: [
				{ name: "Login", position: 0.9 },
				{ name: "Plot map", position: 0.08 },
				{ name: "Harvest log", position: 0.5 },
				{ name: "Watering schedule", position: 0.08 },
			],
		});
		assert.equal(
			desc(svg),
			"Plot map: uphill, 0.08. Watering schedule: uphill, 0.08. Harvest log: top, 0.50. Login: downhill, 0.90.",
		);
	});

	test("describes the sample's 9 scopes", () => {
		assert.equal(
			desc(renderSvg(fixture("sample"))),
			"Plot map: uphill, 0.08. Seed catalogue import: uphill, 0.22. Watering schedule: uphill, 0.35. " +
				"Volunteer sign-up and shift swapping between neighbours: uphill, 0.45. Harvest log: top, 0.50. " +
				"Compost tracker: downhill, 0.62. Tool library: downhill, 0.74. Notifications: downhill, 0.86. " +
				"Login: downhill, 0.97.",
		);
	});

	test('describes a hill chart without scopes as "No scopes."', () => {
		assert.equal(desc(renderSvg({ scopes: [] })), "No scopes.");
	});

	test("titles the svg with the chart's title", () => {
		assert.equal(
			title(renderSvg(fixture("sample"))),
			"Community garden planner",
		);
	});

	test('titles an untitled chart "Hill chart"', () => {
		const svg = renderSvg({ scopes: [] });
		assert.equal(title(svg), "Hill chart");
		assert.doesNotMatch(svg, /<text/);
	});

	test("draws one group per scope, in data order", () => {
		const svg = renderSvg({
			scopes: [
				{ name: "Login", position: 0.9 },
				{ name: "Plot map", position: 0.08 },
			],
		});
		const groups = svg.match(/<g class="scope">[\s\S]*?<\/g>/g) ?? [];
		assert.equal(groups.length, 2);
		assert.match(groups[0], />Login</);
		assert.match(groups[1], />Plot map</);
	});

	test("escapes the text it draws", () => {
		const svg = renderSvg({
			title: "Tom's <plan>",
			scopes: [{ name: '<a & "b">', position: 0.3 }],
		});
		assert.match(svg, />&lt;a &amp; &quot;b&quot;&gt;</);
		assert.match(desc(svg) ?? "", /^&lt;a &amp; &quot;b&quot;&gt;: uphill/);
		assert.equal(title(svg), "Tom&apos;s &lt;plan&gt;");
		assert.doesNotMatch(svg, /<a|<plan|"b"/);
	});

	test("writes no negative zero", () => {
		assert.doesNotMatch(renderSvg(fixture("extremes")), /-0\.0\b/);
	});

	test("writes every number with one decimal", () => {
		const svg = renderSvg(fixture("sample"));
		const numbers = [...svg.matchAll(/ ([\w-]+)="([^"]*)"/g)]
			.filter(([, attribute]) => attribute !== "font-weight")
			.flatMap(([, , value]) => value.split(/[\s,ML]+/))
			.filter((token) => /^-?[\d.]+$/.test(token));
		assert.ok(numbers.length > 100);
		assert.deepEqual(
			numbers.filter((n) => !/^-?\d+\.\d$/.test(n)),
			[],
		);
	});
});
