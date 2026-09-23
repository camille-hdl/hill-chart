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

/** The `d` of the hill: the last path drawn before the scopes. */
function hill(svg: string): string | undefined {
	const beforeScopes = svg.split('<g class="scope">')[0];
	return [...beforeScopes.matchAll(/<path d="([^"]*)"/g)].at(-1)?.[1];
}

describe("renderSvg", () => {
	for (const name of [
		"sample",
		"empty",
		"extremes",
		"long-names",
		"title-subtitle",
	]) {
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
			"Plot map: uphill, 0.08. Watering schedule: uphill, 0.08. Harvest log: top, 0.5. Login: downhill, 0.9.",
		);
	});

	test("describes the sample's 9 scopes", () => {
		assert.equal(
			desc(renderSvg(fixture("sample"))),
			"Plot map: uphill, 0.08. Seed catalogue import: uphill, 0.22. Watering schedule: uphill, 0.35. " +
				"Volunteer sign-up and shift swapping between neighbours: uphill, 0.45. Harvest log: top, 0.5. " +
				"Compost tracker: downhill, 0.62. Tool library: downhill, 0.74. Notifications: downhill, 0.86. " +
				"Login: downhill, 0.97.",
		);
	});

	test("describes a position as typed, never rounded across a side", () => {
		const svg = renderSvg({
			scopes: [
				{ name: "Plot map", position: 0.499 },
				{ name: "Login", position: 0.501 },
			],
		});
		assert.equal(desc(svg), "Plot map: uphill, 0.499. Login: downhill, 0.501.");
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

	test("draws the subtitle after the title, in the muted color at weight 600", () => {
		const svg = renderSvg(fixture("title-subtitle"));
		const texts = svg.match(/<text [^>]*>.*<\/text>/g) ?? [];
		assert.match(
			texts.at(-2) ?? "",
			/font-weight="700" fill="#262a33">.*>Neighbourhood tool library</,
		);
		assert.match(
			texts.at(-1) ?? "",
			/font-weight="600" fill="#6b6259">.*>Cycle 2, week 5: before the spring open day</,
		);
		assert.equal(title(svg), "Neighbourhood tool library");
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

	test("paints the background over the whole viewBox", () => {
		const svg = renderSvg(fixture("sample"));
		const viewBox = svg.match(/viewBox="(\S+) (\S+) (\S+) (\S+)"/)?.slice(1);
		assert.ok(viewBox);
		const [x, y, width, height] = viewBox;
		assert.match(
			svg,
			new RegExp(
				`\n<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#fff1e5"/>\n`,
			),
		);
	});

	test("draws no background on a transparent theme", () => {
		const svg = renderSvg(fixture("sample"), { background: "transparent" });
		assert.doesNotMatch(svg, /<rect|transparent/);
		assert.equal(
			svg,
			renderSvg(fixture("sample")).replace(/<rect [^>]*>\n/, ""),
		);
	});

	test("colors each element with its theme key", () => {
		const svg = renderSvg(fixture("title-subtitle"), {
			background: "#010101",
			ink: "#020202",
			muted: "#030303",
			dot: "#ABC",
			axis: "#050505",
		});
		const fill = (element: string | undefined) =>
			element?.match(/ fill="([^"]*)"/)?.[1];
		const stroke = (element: string | undefined) =>
			element?.match(/ stroke="([^"]*)"/)?.[1];
		const texts = svg.match(/<text [^>]*>/g) ?? [];
		const [beforeScopes, ...groups] = svg.split('<g class="scope">');
		const [axisPath, hillPath] = beforeScopes.match(/<path [^>]*>/g) ?? [];
		const dots = groups.map((group) => group.match(/<path [^>]*>/)?.[0]);
		assert.equal(fill(svg.match(/<rect [^>]*>/)?.[0]), "#010101");
		assert.equal(stroke(axisPath), "#050505");
		assert.equal(stroke(hillPath), "#020202");
		assert.ok(dots.length > 0);
		assert.deepEqual(new Set(dots.map(fill)), new Set(["#abc"]));
		assert.deepEqual(texts.map(fill), [
			...dots.map(() => "#020202"), // names
			"#020202", // title
			"#030303", // subtitle
		]);
	});

	test("draws the same hill whatever the scopes", () => {
		assert.equal(
			hill(renderSvg(fixture("sample"))),
			hill(renderSvg(fixture("extremes"))),
		);
	});

	test("joins the hill's passes at both feet", () => {
		const passes = (hill(renderSvg(fixture("sample"))) ?? "")
			.split("M")
			.slice(1)
			.map((pass) => pass.trim().split(" "));
		assert.equal(passes.length, 2);
		const [first, second] = passes;
		assert.equal(second[0], first[0]);
		assert.equal(second.at(-1), first.at(-1));
		assert.notDeepEqual(second, first);
	});

	test("draws a different hill with another seed", () => {
		const chart = fixture("sample");
		assert.notEqual(
			hill(renderSvg(chart, { seed: 2 })),
			hill(renderSvg(chart)),
		);
	});

	test("draws a scope's dot the same whatever the other scopes", () => {
		const a = { name: "Plot map", position: 0.08 };
		const b = { name: "Harvest log", position: 0.5 };
		const c = { name: "Login", position: 0.97 };
		const dotOfB = (scopes: HillChart["scopes"]) => {
			const svg = renderSvg({ scopes });
			const groups = svg.match(/<g class="scope">[\s\S]*?<\/g>/g) ?? [];
			const group = groups.find((g) => g.includes(">Harvest log<"));
			return group?.match(/<path d="([^"]*)"/)?.[1];
		};
		const dot = dotOfB([b]);
		assert.ok(dot);
		assert.equal(dotOfB([a, b]), dot);
		assert.equal(dotOfB([b, a, c]), dot);
	});

	test("writes the same bytes for the same input", () => {
		assert.equal(renderSvg(fixture("sample")), renderSvg(fixture("sample")));
	});

	test("writes no negative zero", () => {
		assert.doesNotMatch(renderSvg(fixture("extremes")), /-0\.0\b/);
	});

	test("writes every number with one decimal", () => {
		const svg = renderSvg(fixture("sample"));
		const numbers = [...svg.matchAll(/ ([\w-]+)="([^"]*)"/g)]
			.filter(([, attribute]) => attribute !== "font-weight")
			.flatMap(([, , value]) => value.split(/[\s,A-Z]+/))
			.filter((token) => /^-?[\d.]+$/.test(token));
		assert.ok(numbers.length > 100);
		assert.deepEqual(
			numbers.filter((n) => !/^-?\d+\.\d$/.test(n)),
			[],
		);
	});
});
