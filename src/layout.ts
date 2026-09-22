import { measure, type Weight, wrap } from "./font.ts";
import type { HillChart, Scope, Theme } from "./input.ts";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type TextBlock = {
	lines: string[];
	anchor: "start" | "end";
	x: number;
	baseline: number; // of the first line
	lineHeight: number;
	weight: Weight;
	size: number;
	box: Box;
};
export type Layout = {
	viewBox: Box; // integers, encloses everything with a margin
	hill: Point[]; // samples from left foot to finish
	axis: [Point, Point];
	scopes: {
		scope: Scope;
		dot: { center: Point; radius: number };
		name: TextBlock;
		leader?: [Point, Point];
	}[]; // data order
	title?: TextBlock;
	subtitle?: TextBlock;
};

/** Height of the hill, as a share of its width. */
const HILL_HEIGHT = 0.25;
const HILL_SAMPLES = 48;
/** Names wrap at this share of the hill's width. */
const WRAP_WIDTH = 0.3;
/** Room kept around measured text, for the SVG's system fonts that may run wider. */
const TEXT_ROOM = 1.2;

// Lengths in em, relative to theme.fontSize.
const DOT_RADIUS = 0.45;
const NAME_GAP = 0.5;
const TITLE_GAP = 1;
const MARGIN = 1;
const TITLE_SIZE = 1.5;
const LINE_HEIGHT = 1.25;
/** From the middle of a line down to its baseline: about half a cap height. */
const HALF_CAP_HEIGHT = 0.35;

/**
 * Places every element of a hill chart in a fixed frame: the left foot at (0, 0), the finish at (W, 0) and the top at
 * (W/2, −H), with W = theme.width. Only the viewBox follows the content.
 */
export function layout(chart: HillChart, theme: Theme): Layout {
	const width = theme.width;
	const height = HILL_HEIGHT * width;
	// `0 -` rather than a unary minus, so that the feet sit at y = 0 and not −0.
	const hill = (p: number): Point => ({
		x: p * width,
		y: 0 - height * Math.sin(Math.PI * p),
	});

	const scopes = chart.scopes.map((scope) =>
		placeScope(scope, hill(scope.position), theme),
	);
	const envelope = boundingBox([
		{ x: 0, y: -height, width, height },
		...scopes.flatMap(({ dot, name }) => [circleBox(dot), name.box]),
	]);
	const em = theme.fontSize;
	const headingsBottom = envelope.y - TITLE_GAP * em;
	const subtitle =
		chart.subtitle === undefined
			? undefined
			: placeHeading(chart.subtitle, 600, em, envelope.x, headingsBottom);
	const title =
		chart.title === undefined
			? undefined
			: placeHeading(
					chart.title,
					700,
					TITLE_SIZE * em,
					envelope.x,
					subtitle ? subtitle.box.y : headingsBottom,
				);
	const headings = [title, subtitle].filter((block) => block !== undefined);

	const result: Layout = {
		viewBox: roundOutward(
			grow(
				boundingBox([envelope, ...headings.map((block) => block.box)]),
				MARGIN * em,
			),
		),
		hill: Array.from({ length: HILL_SAMPLES + 1 }, (_, i) =>
			hill(i / HILL_SAMPLES),
		),
		axis: [hill(0.5), { x: width / 2, y: 0 }],
		scopes,
	};
	if (title) result.title = title;
	if (subtitle) result.subtitle = subtitle;
	return result;
}

function placeScope(
	scope: Scope,
	center: Point,
	theme: Theme,
): Layout["scopes"][number] {
	const em = theme.fontSize;
	const radius = DOT_RADIUS * em;
	const offset = radius + NAME_GAP * em;
	const lines = wrap(scope.name, WRAP_WIDTH * theme.width, 600, em);
	const name =
		scope.position < 0.5
			? textBlock(lines, 600, em, "end", center.x - offset, center.y)
			: textBlock(lines, 600, em, "start", center.x + offset, center.y);
	return { scope, dot: { center, radius }, name };
}

/** A title or subtitle: one line starting at `x`, its box ending at `bottom`. */
function placeHeading(
	text: string,
	weight: Weight,
	size: number,
	x: number,
	bottom: number,
): TextBlock {
	const middle = bottom - (LINE_HEIGHT * size) / 2;
	return textBlock([text], weight, size, "start", x, middle);
}

/** A block of text whose lines are vertically centered on `middle`. */
function textBlock(
	lines: string[],
	weight: Weight,
	size: number,
	anchor: TextBlock["anchor"],
	x: number,
	middle: number,
): TextBlock {
	const lineHeight = LINE_HEIGHT * size;
	const width =
		TEXT_ROOM * Math.max(...lines.map((line) => measure(line, weight, size)));
	const height = lines.length * lineHeight;
	const top = middle - height / 2;
	return {
		lines,
		anchor,
		x,
		baseline: top + lineHeight / 2 + HALF_CAP_HEIGHT * size,
		lineHeight,
		weight,
		size,
		box: { x: anchor === "end" ? x - width : x, y: top, width, height },
	};
}

function circleBox({ center, radius }: { center: Point; radius: number }): Box {
	return {
		x: center.x - radius,
		y: center.y - radius,
		width: 2 * radius,
		height: 2 * radius,
	};
}

function boundingBox(boxes: Box[]): Box {
	const left = Math.min(...boxes.map((b) => b.x));
	const top = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.width));
	const bottom = Math.max(...boxes.map((b) => b.y + b.height));
	return { x: left, y: top, width: right - left, height: bottom - top };
}

function grow(box: Box, margin: number): Box {
	return {
		x: box.x - margin,
		y: box.y - margin,
		width: box.width + 2 * margin,
		height: box.height + 2 * margin,
	};
}

function roundOutward(box: Box): Box {
	const x = Math.floor(box.x);
	const y = Math.floor(box.y);
	return {
		x,
		y,
		width: Math.ceil(box.x + box.width) - x,
		height: Math.ceil(box.y + box.height) - y,
	};
}
