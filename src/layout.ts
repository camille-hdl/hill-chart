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

type Dot = Layout["scopes"][number]["dot"];

/** Height of the hill, as a share of its width. */
const HILL_HEIGHT = 0.25;
const HILL_SAMPLES = 48;
/** Names wrap at this share of the hill's width. */
const WRAP_WIDTH = 0.3;
/** Room kept around measured text, for the SVG's system fonts that may run wider. */
const TEXT_ROOM = 1.2;

// Lengths in em, relative to theme.fontSize.
const DOT_RADIUS = 0.45;
/** Between a dot and its own name. */
const NAME_GAP = 0.5;
/** Between a name and anything placed before it: another name, a dot, a leader line. */
const CLEARANCE = 0.25;
/**
 * Between a name and the hill's centerline. The drawn hill's ink (svg's Wobble and stroke) strays from it by up to about
 * 0.24 em with the default theme, and 0.31 em on the widest hill with the smallest text (width 4000, fontSize 6).
 */
const HILL_CLEARANCE = 0.5;
/** A name whose box has moved further than this from its dot's center, vertically, gets a leader line. */
const LEADER_THRESHOLD = 1;
/** Between a leader line and its name. */
const LEADER_GAP = 0.25;
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

	/** The highest point of the hill between `left` and `right`, if the hill spans any of it. */
	const hillTop = (left: number, right: number): number | undefined => {
		const [from, to] = [Math.max(left, 0), Math.min(right, width)];
		if (from > to) return undefined;
		return hill(Math.min(Math.max(width / 2, from), to) / width).y;
	};

	const scopes = placeScopes(chart.scopes, hill, hillTop, theme);
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

/**
 * Places every dot on the hill, then every name, from the lowest dot to the highest: each name starts centered on its
 * dot and only moves up, first clear of the hill, then clear of every dot and of the names and leader lines already
 * placed.
 */
function placeScopes(
	scopes: Scope[],
	hill: (p: number) => Point,
	hillTop: (left: number, right: number) => number | undefined,
	theme: Theme,
): Layout["scopes"] {
	const em = theme.fontSize;
	const dots = scopes.map(
		({ position }): Dot => ({
			center: hill(position),
			radius: DOT_RADIUS * em,
		}),
	);
	const obstacles = dots.map((dot) => grow(circleBox(dot), CLEARANCE * em));
	const placed: Layout["scopes"] = [];
	const lowestFirst = dots
		.map((_, i) => i)
		.sort((i, j) => dots[j].center.y - dots[i].center.y);
	for (const i of lowestFirst) {
		const name = placeName(scopes[i], dots[i], obstacles, hillTop, theme);
		const leader = leaderLine(name, dots[i], em);
		obstacles.push(
			...[name.box, ...(leader ? [pointsBox(leader)] : [])].map((box) =>
				grow(box, CLEARANCE * em),
			),
		);
		placed[i] = {
			scope: scopes[i],
			dot: dots[i],
			name,
			...(leader && { leader }),
		};
	}
	return placed;
}

function placeName(
	scope: Scope,
	{ center, radius }: Dot,
	obstacles: Box[],
	hillTop: (left: number, right: number) => number | undefined,
	theme: Theme,
): TextBlock {
	const em = theme.fontSize;
	const offset = radius + NAME_GAP * em;
	const lines = wrap(scope.name, WRAP_WIDTH * theme.width, 600, em);
	const start =
		scope.position < 0.5
			? textBlock(lines, 600, em, "end", center.x - offset, center.y)
			: textBlock(lines, 600, em, "start", center.x + offset, center.y);
	const { box } = start;
	const clearance = HILL_CLEARANCE * em;
	const hillBelow = hillTop(box.x - clearance, box.x + box.width + clearance);
	const clearOfHill =
		hillBelow === undefined
			? box.y
			: Math.min(box.y, hillBelow - clearance - box.height);
	const top = firstFreeTop({ ...box, y: clearOfHill }, obstacles);
	return moveUp(start, box.y - top);
}

/**
 * A line from the side of a name that faces its dot, level with its nearest line, to the dot's center, when the name
 * box has moved away from its dot.
 */
function leaderLine(
	{ anchor, x, lineHeight, box }: TextBlock,
	{ center }: Dot,
	em: number,
): [Point, Point] | undefined {
	const bottom = box.y + box.height;
	const away = Math.max(box.y - center.y, center.y - bottom);
	if (away <= LEADER_THRESHOLD * em) return undefined;
	const nearestLine = Math.min(
		Math.max(center.y, box.y + lineHeight / 2),
		bottom - lineHeight / 2,
	);
	const gap = LEADER_GAP * em;
	return [{ x: anchor === "end" ? x + gap : x - gap, y: nearestLine }, center];
}

/**
 * The top of `box` once it has moved up, if needed, until it overlaps none of `obstacles`. Each move puts it right
 * above the obstacle in its way, so the loop ends.
 */
function firstFreeTop(box: Box, obstacles: Box[]): number {
	let top = box.y;
	for (let moved = true; moved; ) {
		moved = false;
		for (const obstacle of obstacles) {
			const above = obstacle.y - box.height;
			if (above < top && overlaps({ ...box, y: top }, obstacle)) {
				top = above;
				moved = true;
			}
		}
	}
	return top;
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

function moveUp(block: TextBlock, distance: number): TextBlock {
	return {
		...block,
		baseline: block.baseline - distance,
		box: { ...block.box, y: block.box.y - distance },
	};
}

function pointsBox([a, b]: [Point, Point]): Box {
	return boundingBox([a, b].map(({ x, y }) => ({ x, y, width: 0, height: 0 })));
}

function circleBox({ center, radius }: { center: Point; radius: number }): Box {
	return {
		x: center.x - radius,
		y: center.y - radius,
		width: 2 * radius,
		height: 2 * radius,
	};
}

function overlaps(a: Box, b: Box): boolean {
	return (
		a.x < b.x + b.width &&
		b.x < a.x + a.width &&
		a.y < b.y + b.height &&
		b.y < a.y + a.height
	);
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
