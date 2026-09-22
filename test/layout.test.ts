import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { type HillChart, readChart, readTheme } from "../src/input.ts";
import { type Box, type Layout, layout, type Point } from "../src/layout.ts";

const theme = readTheme(undefined);
const fixtures = ["sample", "empty", "extremes", "title-subtitle"];

function fixture(name: string): HillChart {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return readChart(JSON.parse(readFileSync(url, "utf8")));
}

/** The hill's height at `x`, interpolated between the layout's samples. */
function hillY(hill: Point[], x: number): number {
	const i = hill.findIndex((p) => p.x >= x);
	if (i === 0) return hill[0].y;
	const [a, b] = [hill[i - 1], hill[i]];
	return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** Every drawn element of a layout, as boxes. */
function elementBoxes(l: Layout): Box[] {
	const pointBox = ({ x, y }: Point): Box => ({ x, y, width: 0, height: 0 });
	return [
		...l.hill.map(pointBox),
		...l.axis.map(pointBox),
		...l.scopes.flatMap(({ dot: { center, radius }, name }) => [
			{
				x: center.x - radius,
				y: center.y - radius,
				width: 2 * radius,
				height: 2 * radius,
			},
			name.box,
		]),
		...(l.title ? [l.title.box] : []),
		...(l.subtitle ? [l.subtitle.box] : []),
	];
}

for (const name of fixtures) {
	describe(`layout of the ${name} fixture`, () => {
		const chart = fixture(name);
		const l = layout(chart, theme);

		test("keeps the scopes in data order", () => {
			assert.deepEqual(
				l.scopes.map((s) => s.scope),
				chart.scopes,
			);
		});

		test("puts each dot on the hill, at its position along the width (invariant 1)", () => {
			for (const { scope, dot } of l.scopes) {
				assert.ok(Math.abs(dot.center.x - scope.position * theme.width) < 1e-9);
				assert.ok(
					Math.abs(dot.center.y - hillY(l.hill, dot.center.x)) < 0.5,
					`${scope.name} is off the hill`,
				);
			}
		});

		test("puts each name on the outer side of its dot (invariant 2)", () => {
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
		});

		test("keeps every element inside an integer viewBox, with a margin (invariant 5)", () => {
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
		});

		test("gives the same layout for the same input (invariant 7)", () => {
			assert.deepEqual(layout(structuredClone(chart), theme), l);
		});
	});
}

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

	test("has no title block without a title", () => {
		assert.equal(layout(fixture("extremes"), theme).title, undefined);
	});
});
