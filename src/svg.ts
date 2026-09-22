import { FONT_FAMILY } from "./font.ts";
import type { Scope, Theme } from "./input.ts";
import type { Layout, Point, TextBlock } from "./layout.ts";

const HILL_STROKE = 3;
const AXIS_STROKE = 2;
const AXIS_DOT_SPACING = 6;

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

/** Serializes a layout as a standalone, accessible SVG document. */
export function toSvg(layout: Layout, theme: Theme): string {
	const { viewBox, axis, title, subtitle } = layout;
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
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${theme.background}"/>`,
		`<line x1="${num(axis[0].x)}" y1="${num(axis[0].y)}" x2="${num(axis[1].x)}" y2="${num(axis[1].y)}" stroke="${theme.axis}" stroke-width="${num(AXIS_STROKE)}" stroke-linecap="round" stroke-dasharray="0.1 ${num(AXIS_DOT_SPACING)}"/>`,
		`<path d="${path(layout.hill)}" fill="none" stroke="${theme.ink}" stroke-width="${num(HILL_STROKE)}" stroke-linecap="round" stroke-linejoin="round"/>`,
		...layout.scopes.map(({ dot, name }) =>
			[
				'<g class="scope">',
				`  <circle cx="${num(dot.center.x)}" cy="${num(dot.center.y)}" r="${num(dot.radius)}" fill="${theme.dot}"/>`,
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

function path(points: Point[]): string {
	return points
		.map(({ x, y }, i) => `${i === 0 ? "M" : "L"}${num(x)},${num(y)}`)
		.join(" ");
}

/** A number with one decimal, never `-0.0`. */
function num(n: number): string {
	const s = n.toFixed(1);
	return s === "-0.0" ? "0.0" : s;
}

function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
