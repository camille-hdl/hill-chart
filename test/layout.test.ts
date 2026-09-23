import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { measure } from "../src/font.ts";
import { type HillChart, readChart, readTheme } from "../src/input.ts";
import { type Box, type Layout, layout, type Point } from "../src/layout.ts";

const theme = readTheme(undefined);
const em = theme.fontSize;
/** The smallest gap the invariants accept between a name and another element. */
const GAP = 0.1 * em;
/**
 * How far the drawn hill's ink strays from `layout.hill` at most with the default theme: its Wobble, then half its
 * stroke. The svg tests check this bound on the drawing.
 */
const HILL_INK = 0.3 * em;
const fixtures = [
	"sample",
	"empty",
	"extremes",
	"crowded",
	"long-names",
	"title-subtitle",
	"uncovered",
];

function fixture(name: string): HillChart {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return readChart(JSON.parse(readFileSync(url, "utf8")));
}

/** The mulberry32 generator, for the random hill charts: numbers in [0, 1). */
function generator(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * `count` random hill charts, always the same: 0 to 15 scopes with positions gathered around a few spots, names of 1
 * to 60 characters, with or without a title and a subtitle.
 */
function randomCharts(count: number): HillChart[] {
	const random = generator(20260923);
	const integer = (min: number, max: number) =>
		min + Math.floor(random() * (max - min + 1));
	const pick = <T>(items: T[]): T => items[integer(0, items.length - 1)];
	const letters = [..."abcdefghijklmnopqrstuvwxyzMWéàçô-"];
	const word = (length: number) =>
		Array.from({ length }, () => pick(letters)).join("");
	const text = () => {
		const length = integer(1, 60);
		if (random() < 0.1) return word(length);
		let words = word(integer(1, 12));
		while (words.length < length) words += ` ${word(integer(1, 12))}`;
		return words.slice(0, length).trim();
	};
	return Array.from({ length: count }, () => {
		const spots = Array.from({ length: integer(1, 3) }, () =>
			pick([0, 0.5, 1, random(), random(), random()]),
		);
		const names = new Set<string>();
		const target = integer(0, 15);
		while (names.size < target) names.add(text());
		const chart: HillChart = {
			scopes: [...names].map((name) => ({
				name,
				position: Math.min(
					1,
					Math.max(0, pick(spots) + (random() - 0.5) * 0.1),
				),
			})),
		};
		if (random() < 0.5) chart.title = text();
		if (random() < 0.5) chart.subtitle = text();
		return readChart(chart);
	});
}

/** The hill's height at `x`, interpolated between the layout's samples. */
function hillY(hill: Point[], x: number): number {
	const i = hill.findIndex((p) => p.x >= x);
	if (i === 0) return hill[0].y;
	const [a, b] = [hill[i - 1], hill[i]];
	return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** How far apart two boxes are, along the axis that separates them best; negative when they overlap. */
function separation(a: Box, b: Box): number {
	return Math.max(
		b.x - (a.x + a.width),
		a.x - (b.x + b.width),
		b.y - (a.y + a.height),
		a.y - (b.y + b.height),
	);
}

function pointBoxDistance(p: Point, box: Box): number {
	const dx = Math.max(box.x - p.x, 0, p.x - (box.x + box.width));
	const dy = Math.max(box.y - p.y, 0, p.y - (box.y + box.height));
	return Math.hypot(dx, dy);
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	const t = Math.min(
		1,
		Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
	);
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function corners(box: Box): Point[] {
	const [right, bottom] = [box.x + box.width, box.y + box.height];
	return [
		{ x: box.x, y: box.y },
		{ x: right, y: box.y },
		{ x: right, y: bottom },
		{ x: box.x, y: bottom },
	];
}

/** Separating axes: the box's two, and the segment's normal. */
function segmentCrossesBox(a: Point, b: Point, box: Box): boolean {
	if (
		Math.max(a.x, b.x) < box.x ||
		Math.min(a.x, b.x) > box.x + box.width ||
		Math.max(a.y, b.y) < box.y ||
		Math.min(a.y, b.y) > box.y + box.height
	) {
		return false;
	}
	const sides = corners(box).map((c) =>
		Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)),
	);
	return !sides.every((s) => s > 0) && !sides.every((s) => s < 0);
}

/** The distance between a box and the hill polyline. */
function hillDistance(hill: Point[], box: Box): number {
	return Math.min(
		...hill.slice(1).map((b, i) => {
			const a = hill[i];
			if (segmentCrossesBox(a, b, box)) return 0;
			return Math.min(
				pointBoxDistance(a, box),
				pointBoxDistance(b, box),
				...corners(box).map((c) => pointSegmentDistance(c, a, b)),
			);
		}),
	);
}

/**
 * How far a name's box sits from its dot's center, vertically: how far its middle is from the dot's center, less half its
 * height. Zero when the box spans the dot's center.
 */
function distanceFromDot({ dot, name }: Layout["scopes"][number]): number {
	const middle = name.box.y + name.box.height / 2;
	return Math.max(0, Math.abs(middle - dot.center.y) - name.box.height / 2);
}

/** Every drawn element of a layout, as boxes. */
function elementBoxes(l: Layout): Box[] {
	const pointBox = ({ x, y }: Point): Box => ({ x, y, width: 0, height: 0 });
	return [
		...l.hill.map(pointBox),
		...l.axis.map(pointBox),
		...l.scopes.flatMap(({ dot: { center, radius }, name, leader }) => [
			{
				x: center.x - radius,
				y: center.y - radius,
				width: 2 * radius,
				height: 2 * radius,
			},
			name.box,
			...(leader ?? []).map(pointBox),
		]),
		...(l.title ? [l.title.box] : []),
		...(l.subtitle ? [l.subtitle.box] : []),
	];
}

/** The invariants every layout keeps, each checked on a hill chart and its layout. */
const invariants: [string, (chart: HillChart, l: Layout) => void][] = [
	[
		"keeps the scopes in data order",
		(chart, l) => {
			assert.deepEqual(
				l.scopes.map((s) => s.scope),
				chart.scopes,
			);
		},
	],
	[
		"puts each dot on the hill, at its position along the width (invariant 1)",
		(_, l) => {
			for (const { scope, dot } of l.scopes) {
				assert.ok(Math.abs(dot.center.x - scope.position * theme.width) < 1e-9);
				assert.ok(
					Math.abs(dot.center.y - hillY(l.hill, dot.center.x)) < 0.5,
					`${scope.name} is off the hill`,
				);
			}
		},
	],
	[
		"puts each name on the outer side of its dot (invariant 2)",
		(_, l) => {
			for (const { scope, dot, name } of l.scopes) {
				if (scope.position < 0.5) {
					assert.equal(name.anchor, "end", scope.name);
					assert.ok(
						name.box.x + name.box.width <= dot.center.x - dot.radius,
						scope.name,
					);
				} else {
					assert.equal(name.anchor, "start", scope.name);
					assert.ok(name.box.x >= dot.center.x + dot.radius, scope.name);
				}
			}
		},
	],
	[
		"keeps each name clear of the other names, the dots, the hill and the headings (invariant 3)",
		(_, l) => {
			const headings = [l.title, l.subtitle].filter((b) => b !== undefined);
			for (const [i, { scope, name }] of l.scopes.entries()) {
				for (const other of l.scopes.slice(i + 1)) {
					assert.ok(
						separation(name.box, other.name.box) >= GAP,
						`${scope.name} overlaps ${other.scope.name}`,
					);
				}
				for (const { scope: owner, dot } of l.scopes) {
					assert.ok(
						pointBoxDistance(dot.center, name.box) >= dot.radius + GAP,
						`${scope.name} overlaps the dot of ${owner.name}`,
					);
				}
				assert.ok(
					hillDistance(l.hill, name.box) >= HILL_INK + GAP,
					`${scope.name} overlaps the hill`,
				);
				for (const heading of headings) {
					assert.ok(
						separation(name.box, heading.box) >= GAP,
						`${scope.name} overlaps ${heading.lines[0]}`,
					);
				}
			}
		},
	],
	[
		"joins a name to its dot with its leader line (invariant 4)",
		(_, l) => {
			for (const { scope, dot, name, leader } of l.scopes) {
				if (!leader) continue;
				const [start, end] = leader;
				assert.ok(pointBoxDistance(start, name.box) < em, scope.name);
				assert.ok(
					Math.hypot(end.x - dot.center.x, end.y - dot.center.y) <= dot.radius,
					scope.name,
				);
			}
		},
	],
	[
		"keeps every element inside an integer viewBox, with a margin (invariant 5)",
		(_, l) => {
			const { x, y, width, height } = l.viewBox;
			assert.ok([x, y, width, height].every(Number.isInteger), "integers");
			const margin = 1;
			for (const box of elementBoxes(l)) {
				assert.ok(box.x >= x + margin, `${JSON.stringify(box)} left`);
				assert.ok(box.y >= y + margin, `${JSON.stringify(box)} top`);
				assert.ok(
					box.x + box.width <= x + width - margin,
					`${JSON.stringify(box)} right`,
				);
				assert.ok(
					box.y + box.height <= y + height - margin,
					`${JSON.stringify(box)} bottom`,
				);
			}
		},
	],
	[
		"wraps names at 0.3 times the width, never within a word (invariant 6)",
		(_, l) => {
			const maxWidth = 0.3 * theme.width;
			for (const { scope, name } of l.scopes) {
				assert.equal(name.lines.join(" "), scope.name);
				for (const line of name.lines) {
					assert.ok(
						measure(line, name.weight, name.size) <= maxWidth ||
							!line.includes(" "),
						`${JSON.stringify(line)} is wider than ${maxWidth} px`,
					);
				}
			}
		},
	],
	[
		"gives the same layout for the same input (invariant 7)",
		(chart, l) => {
			assert.deepEqual(layout(structuredClone(chart), theme), l);
		},
	],
];

for (const name of fixtures) {
	describe(`layout of the ${name} fixture`, () => {
		const chart = fixture(name);
		const l = layout(chart, theme);
		for (const [title, check] of invariants) {
			test(title, () => check(chart, l));
		}
	});
}

const randomHillCharts = randomCharts(200);

describe("layout of 200 random hill charts", () => {
	for (const [title, check] of invariants) {
		test(title, () => {
			for (const [i, chart] of randomHillCharts.entries()) {
				try {
					check(chart, layout(chart, theme));
				} catch (error) {
					throw new Error(`random chart ${i}: ${JSON.stringify(chart)}`, {
						cause: error,
					});
				}
			}
		});
	}
});

describe("layout", () => {
	test("spans the hill over the theme width, feet on the ground", () => {
		const { hill } = layout({ scopes: [] }, theme);
		assert.deepEqual(hill[0], { x: 0, y: 0 });
		assert.equal(hill.at(-1)?.x, theme.width);
		assert.ok(Math.abs(hill.at(-1)?.y ?? Number.NaN) < 1e-9);
	});

	test("spans the hill over a theme's width, whatever the names", () => {
		const narrow = readTheme({ width: 480 });
		for (const chart of [fixture("sample"), fixture("empty")]) {
			const l = layout(chart, narrow);
			assert.deepEqual(l.hill[0], { x: 0, y: 0 });
			assert.equal(l.hill.at(-1)?.x, 480);
			assert.deepEqual(
				l.scopes.map(({ dot }) => dot.center.x),
				chart.scopes.map(({ position }) => position * 480),
			);
		}
	});

	test("sizes names and subtitle at the theme's font size, and the title at 1.5 times", () => {
		const l = layout(fixture("sample"), readTheme({ fontSize: 24 }));
		assert.deepEqual(
			new Set(l.scopes.map(({ name }) => name.size)),
			new Set([24]),
		);
		assert.equal(l.subtitle?.size, 24);
		assert.equal(l.title?.size, 36);
	});

	test("places a scope's dot regardless of the other scopes", () => {
		const a = { name: "A", position: 0.3 };
		const b = { name: "B", position: 0.6 };
		const c = { name: "C", position: 0.61 };
		const centerOfB = (scopes: HillChart["scopes"]) =>
			layout({ scopes }, theme).scopes.find((s) => s.scope.name === "B")?.dot
				.center;
		const alone = centerOfB([b]);
		assert.deepEqual(centerOfB([a, b]), alone);
		assert.deepEqual(centerOfB([b, a, c]), alone);
	});

	test("puts the title above everything else", () => {
		const l = layout(fixture("sample"), theme);
		assert.ok(l.title);
		assert.deepEqual(l.title.lines, ["Community garden planner"]);
		const titleBottom = l.title.box.y + l.title.box.height;
		const others = elementBoxes({ ...l, title: undefined });
		assert.ok(others.every((box) => box.y >= titleBottom));
	});

	test("puts the subtitle under the title, above the chart, at weight 600", () => {
		const l = layout(fixture("title-subtitle"), theme);
		assert.ok(l.title && l.subtitle);
		assert.deepEqual(l.subtitle.lines, [
			"Cycle 2, week 5: before the spring open day",
		]);
		assert.equal(l.subtitle.weight, 600);
		assert.equal(l.subtitle.x, l.title.x);
		assert.ok(l.title.box.y + l.title.box.height <= l.subtitle.box.y);
		const subtitleBottom = l.subtitle.box.y + l.subtitle.box.height;
		const chart = elementBoxes({ ...l, title: undefined, subtitle: undefined });
		assert.ok(chart.every((box) => box.y >= subtitleBottom));
	});

	test("puts a subtitle without title above the chart", () => {
		const l = layout({ subtitle: "Week 12", scopes: [] }, theme);
		assert.ok(l.subtitle);
		assert.equal(l.title, undefined);
		const subtitleBottom = l.subtitle.box.y + l.subtitle.box.height;
		const chart = elementBoxes({ ...l, subtitle: undefined });
		assert.ok(chart.every((box) => box.y >= subtitleBottom));
	});

	test("gives a leader line to the names further from their dot than one threshold, and only them (invariant 4)", () => {
		const layouts = [readTheme({ width: 480 }), theme].flatMap((t) =>
			[...fixtures.map(fixture), ...randomHillCharts].map((chart) =>
				layout(chart, t),
			),
		);
		const scopes = layouts.flatMap((l) => l.scopes);
		const withLeader = scopes.filter((s) => s.leader).map(distanceFromDot);
		const without = scopes.filter((s) => !s.leader).map(distanceFromDot);
		assert.ok(
			Math.max(...without) < Math.min(...withLeader),
			`${Math.max(...without)} px without a leader line, ${Math.min(...withLeader)} px with one`,
		);
	});

	test("draws leader lines in a crowded chart", () => {
		const { scopes } = layout(fixture("crowded"), theme);
		assert.ok(scopes.some((s) => s.leader));
	});

	test("has no title block without a title", () => {
		assert.equal(layout(fixture("extremes"), theme).title, undefined);
	});

	test("lays out a name of 400,000 one-letter words, one per line", () => {
		const name = Array(400_000).fill("a").join(" ");
		const narrow = readTheme({ width: 200, fontSize: 96 });
		const { scopes } = layout({ scopes: [{ name, position: 0.5 }] }, narrow);
		assert.equal(scopes[0].name.lines.length, 400_000);
	});
});
