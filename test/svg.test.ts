import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type HillChart, renderSvg } from "../src/index.ts";
import { readChart, readTheme } from "../src/input.ts";
import { layout, type Point } from "../src/layout.ts";

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

/** Every `<g class="scope">`, in data order. */
function groups(svg: string): string[] {
	return svg.match(/<g class="scope">[\s\S]*?<\/g>/g) ?? [];
}

/** The `<g class="scope">` holding the one-line name `name`. */
function group(svg: string, name: string): string | undefined {
	return groups(svg).find((g) => g.includes(`>${name}<`));
}

/** The `d` of each scope's leader line, in data order; undefined for a scope without one. */
function leaderPaths(svg: string): (string | undefined)[] {
	return groups(svg).map((g) => g.match(/<path d="([^"]*)" fill="none"/)?.[1]);
}

/** The `d` of the hill: the last path drawn before the scopes. */
function hill(svg: string): string | undefined {
	const beforeScopes = svg.split('<g class="scope">')[0];
	return [...beforeScopes.matchAll(/<path d="([^"]*)"/g)].at(-1)?.[1];
}

const fixtures = [
	"sample",
	"empty",
	"extremes",
	"crowded",
	"long-names",
	"title-subtitle",
	"uncovered",
];

describe("renderSvg", () => {
	for (const name of fixtures) {
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
		const dots = groups.map(
			(group) => group.match(/<path [^>]* fill="(?!none)[^>]*>/)?.[0],
		);
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
		const dotOfB = (scopes: HillChart["scopes"]) =>
			group(renderSvg({ scopes }), "Harvest log")?.match(
				/<path d="([^"]*)" fill="#990f3d"/,
			)?.[1];
		const dot = dotOfB([b]);
		assert.ok(dot);
		assert.equal(dotOfB([a, b]), dot);
		assert.equal(dotOfB([b, a, c]), dot);
	});

	test("draws each leader line of the layout first in its scope's group, in the muted color", () => {
		let drawn = 0;
		for (const name of fixtures) {
			const chart = fixture(name);
			const { scopes } = layout(readChart(chart), readTheme(undefined));
			const svg = renderSvg(chart, { muted: "#030303" });
			for (const [i, g] of groups(svg).entries()) {
				if (scopes[i].leader) {
					drawn++;
					assert.match(
						g,
						/^<g class="scope">\n {2}<path d="[^"]*" fill="none" stroke="#030303" [^>]*>\n {2}<path d="[^"]*" fill="#990f3d"\/>\n {2}<text /,
						`${name}: ${scopes[i].scope.name}`,
					);
				} else {
					assert.doesNotMatch(
						g,
						/fill="none"/,
						`${name}: ${scopes[i].scope.name}`,
					);
				}
			}
		}
		assert.ok(drawn > 0);
	});

	test("draws each leader line the same whatever the order of the scopes", () => {
		// Moving the last scope first keeps every placement: names are placed from the lowest dot, ties in data order.
		const chart = fixture("crowded");
		const last = chart.scopes.at(-1);
		assert.ok(last);
		const reordered = {
			...chart,
			scopes: [last, ...chart.scopes.slice(0, -1)],
		};
		const leaders = leaderPaths(renderSvg(chart));
		assert.ok(leaders.some((d) => d !== undefined));
		assert.deepEqual(leaderPaths(renderSvg(reordered)), [
			leaders.at(-1),
			...leaders.slice(0, -1),
		]);
		const reseeded = leaderPaths(renderSvg(chart, { seed: 2 }));
		for (const [i, d] of leaders.entries()) {
			if (d !== undefined) assert.notEqual(reseeded[i], d);
		}
	});

	test("keeps the drawn hill's ink within 0.3 em of the layout's hill, whatever the seed", () => {
		const theme = readTheme(undefined);
		const { hill: samples } = layout(readChart({ scopes: [] }), theme);
		for (let seed = 1; seed <= 50; seed++) {
			const svg = renderSvg({ scopes: [] }, { seed });
			const [, d, strokeWidth] =
				svg.match(
					/<path d="([^"]*)" [^>]*stroke="#262a33" stroke-width="([^"]*)"/,
				) ?? [];
			const reach = Math.max(
				...bezierPoints(d).map((p) => polylineDistance(samples, p)),
			);
			assert.ok(
				reach + Number(strokeWidth) / 2 <= 0.3 * theme.fontSize,
				`seed ${seed}: the ink reaches ${reach} px from the hill`,
			);
		}
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

/** Points along every cubic Bézier curve of a path made of `M` and `C` commands. */
function bezierPoints(d: string): Point[] {
	const points: Point[] = [];
	for (const pass of d.split("M").slice(1)) {
		const numbers = pass
			.split(/[\s,C]+/)
			.filter(Boolean)
			.map(Number);
		let start = { x: numbers[0], y: numbers[1] };
		for (let i = 2; i + 5 < numbers.length; i += 6) {
			const [c1, c2, end] = [0, 2, 4].map((j) => ({
				x: numbers[i + j],
				y: numbers[i + j + 1],
			}));
			for (let t = 0; t <= 1; t += 1 / 32) {
				const [a, b, c, e] = [
					(1 - t) ** 3,
					3 * (1 - t) ** 2 * t,
					3 * (1 - t) * t ** 2,
					t ** 3,
				];
				points.push({
					x: a * start.x + b * c1.x + c * c2.x + e * end.x,
					y: a * start.y + b * c1.y + c * c2.y + e * end.y,
				});
			}
			start = end;
		}
	}
	return points;
}

function polylineDistance(polyline: Point[], p: Point): number {
	return Math.min(
		...polyline.slice(1).map((b, i) => {
			const a = polyline[i];
			const [dx, dy] = [b.x - a.x, b.y - a.y];
			const t = Math.min(
				1,
				Math.max(
					0,
					((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
				),
			);
			return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
		}),
	);
}
