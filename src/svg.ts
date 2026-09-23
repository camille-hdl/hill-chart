import { FONT_FAMILY } from "./font.ts";
import type { Scope, Theme } from "./input.ts";
import type { Layout, Point, TextBlock } from "./layout.ts";

// Lengths in em, relative to theme.fontSize.
const HILL_STROKE = 0.13;
const HILL_WOBBLE = 0.12;
const AXIS_STROKE = 0.11;
const AXIS_DOT_SPACING = 0.33;
const AXIS_WOBBLE = 0.1;
const LEADER_STROKE = 0.07;
const LEADER_WOBBLE = 0.06;

/** The hill is smoothed through every HILL_STEP-th sample of the layout, then wobbled. */
const HILL_STEP = 4;
/** The hill is drawn twice, each pass wobbled on its own. */
const HILL_PASSES = 2;
/** The axis is smoothed through this many points, from the top to the ground. */
const AXIS_POINTS = 5;
/** A leader line is smoothed through this many points, from its name to its dot. */
const LEADER_POINTS = 3;
/** Enough vertices for a dot to stay round once smoothed. */
const DOT_VERTICES = 12;
/** How far a dot's outline strays from its radius at most, as a share of it. */
const DOT_WOBBLE = 0.1;

type Random = () => number;

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

/** Serializes a layout as a standalone, accessible SVG document. */
export function toSvg(layout: Layout, theme: Theme): string {
	const { viewBox, title, subtitle } = layout;
	const em = theme.fontSize;
	const [x, y, width, height] = [
		viewBox.x,
		viewBox.y,
		viewBox.width,
		viewBox.height,
	].map(num);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${width} ${height}" width="${width}" height="${height}" role="img">`,
		`<title>${escapeXml(title?.lines.join(" ") ?? "Hill chart")}</title>`,
		`<desc>${escapeXml(describe(layout.scopes.map(({ scope }) => scope)))}</desc>`,
		...(theme.background === "transparent"
			? []
			: [
					`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.background}"/>`,
				]),
		`<path d="${wavyLine(layout.axis, AXIS_POINTS, AXIS_WOBBLE * em, wobble(theme, "axis"))}" fill="none" stroke="${theme.axis}" stroke-width="${num(AXIS_STROKE * em)}" stroke-linecap="round" stroke-dasharray="0.1 ${num(AXIS_DOT_SPACING * em)}"/>`,
		`<path d="${hillPath(layout.hill, em, wobble(theme, "hill"))}" fill="none" stroke="${theme.ink}" stroke-width="${num(HILL_STROKE * em)}" stroke-linecap="round" stroke-linejoin="round"/>`,
		...layout.scopes.map(({ scope, dot, name, leader }) =>
			[
				'<g class="scope">',
				...(leader
					? [
							`  <path d="${wavyLine(leader, LEADER_POINTS, LEADER_WOBBLE * em, wobble(theme, `leader:${scope.name}`))}" fill="none" stroke="${theme.muted}" stroke-width="${num(LEADER_STROKE * em)}" stroke-linecap="round"/>`,
						]
					: []),
				`  <path d="${dotPath(dot, wobble(theme, `scope:${scope.name}`))}" fill="${theme.dot}"/>`,
				`  ${text(name, theme.ink)}`,
				"</g>",
			].join("\n"),
		),
		...(title ? [text(title, theme.ink)] : []),
		...(subtitle ? [text(subtitle, theme.muted)] : []),
		"</svg>",
		"",
	].join("\n");
}

/** The `<desc>` text: every scope with its side of the hill and its position, sorted by position. */
function describe(scopes: Scope[]): string {
	if (scopes.length === 0) return "No scopes.";
	return scopes
		.toSorted((a, b) => a.position - b.position)
		.map(
			({ name, position }) =>
				`${name}: ${side(position)}, ${String(position)}.`,
		)
		.join(" ");
}

function side(position: number): string {
	if (position < 0.5) return "uphill";
	return position === 0.5 ? "top" : "downhill";
}

function text(block: TextBlock, color: string): string {
	const lines = block.lines.map(
		(line, i) =>
			`<tspan x="${num(block.x)}" y="${num(block.baseline + i * block.lineHeight)}">${escapeXml(line)}</tspan>`,
	);
	return `<text text-anchor="${block.anchor}" font-family="${FONT_FAMILY}" font-size="${num(block.size)}" font-weight="${block.weight}" fill="${color}">${lines.join("")}</text>`;
}

/** A slightly wavy line from `from` to `to`, smoothed through `count` points each shaken by up to `amplitude`. */
function wavyLine(
	[from, to]: [Point, Point],
	count: number,
	amplitude: number,
	random: Random,
): string {
	const points = Array.from({ length: count }, (_, i) => {
		const t = i / (count - 1);
		const point = {
			x: from.x + t * (to.x - from.x),
			y: from.y + t * (to.y - from.y),
		};
		return shake(point, amplitude, random);
	});
	return smooth(points);
}

/**
 * The hill in HILL_PASSES slightly offset strokes, each through the same few samples. The passes join at both feet:
 * only the samples in between are wobbled.
 */
function hillPath(samples: Point[], em: number, random: Random): string {
	const controls = samples.filter(
		(_, i) => i % HILL_STEP === 0 || i === samples.length - 1,
	);
	const [foot, finish] = [controls[0], controls[controls.length - 1]];
	return Array.from({ length: HILL_PASSES }, () =>
		smooth([
			foot,
			...controls
				.slice(1, -1)
				.map((point) => shake(point, HILL_WOBBLE * em, random)),
			finish,
		]),
	).join(" ");
}

/**
 * A closed irregular circle. Its radius varies along two slow waves of random phase and strength, so the outline
 * stays smooth and never gets a corner.
 */
function dotPath(
	{ center, radius }: Layout["scopes"][number]["dot"],
	random: Random,
): string {
	const waves = [2, 3].map((frequency) => ({
		frequency,
		phase: 2 * Math.PI * random(),
		strength: random() / 2, // two waves: their sum stays within [−1, 1]
	}));
	const vertices = Array.from({ length: DOT_VERTICES }, (_, i) => {
		const angle = (2 * Math.PI * i) / DOT_VERTICES;
		const bulge = waves.reduce(
			(sum, { frequency, phase, strength }) =>
				sum + strength * Math.sin(frequency * angle + phase),
			0,
		);
		const distance = radius * (1 + DOT_WOBBLE * bulge);
		return {
			x: center.x + distance * Math.cos(angle),
			y: center.y + distance * Math.sin(angle),
		};
	});
	return smooth(vertices, "closed");
}

/**
 * The Wobble's generator for one element (ADR 0002): it depends only on the seed and the element's key, never on the
 * other elements.
 */
function wobble(theme: Theme, key: string): Random {
	return mulberry32(fnv1a(`${theme.seed}\0${key}`));
}

/** `point` moved by less than `amplitude` along each axis. */
function shake({ x, y }: Point, amplitude: number, random: Random): Point {
	return {
		x: x + (2 * random() - 1) * amplitude,
		y: y + (2 * random() - 1) * amplitude,
	};
}

/** A smooth path through `points`: Catmull-Rom splines written as cubic Bézier curves. */
function smooth(points: Point[], shape: "open" | "closed" = "open"): string {
	const n = points.length;
	const at = (i: number) =>
		shape === "closed"
			? points[(i + n) % n]
			: points[Math.min(Math.max(i, 0), n - 1)];
	const ends =
		shape === "closed" ? [...points.slice(1), points[0]] : points.slice(1);
	const curves = ends.map((end, i) => {
		const [before, start, after] = [at(i - 1), at(i), at(i + 2)];
		const c1 = {
			x: start.x + (end.x - before.x) / 6,
			y: start.y + (end.y - before.y) / 6,
		};
		const c2 = {
			x: end.x - (after.x - start.x) / 6,
			y: end.y - (after.y - start.y) / 6,
		};
		return `C${xy(c1)} ${xy(c2)} ${xy(end)}`;
	});
	return [
		`M${xy(points[0])}`,
		...curves,
		...(shape === "closed" ? ["Z"] : []),
	].join(" ");
}

function xy({ x, y }: Point): string {
	return `${num(x)},${num(y)}`;
}

/** 32-bit FNV-1a hash of the UTF-8 bytes of `text`. */
function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (const byte of new TextEncoder().encode(text)) {
		hash = Math.imul(hash ^ byte, 0x01000193);
	}
	return hash >>> 0;
}

/** The mulberry32 generator: numbers in [0, 1). */
function mulberry32(seed: number): Random {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A number with one decimal, never `-0.0`. */
function num(n: number): string {
	const s = n.toFixed(1);
	return s === "-0.0" ? "0.0" : s;
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
