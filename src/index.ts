import { type HillChart, readChart, readTheme, type Theme } from "./input.ts";
import { type Box, layout } from "./layout.ts";
import { toPng } from "./png.ts";
import { toSvg } from "./svg.ts";

export {
	type HillChart,
	HillChartError,
	type Scope,
	type Theme,
} from "./input.ts";

/** Draws a hill chart as an SVG document. Throws `HillChartError` on invalid data or theme. */
export function renderSvg(chart: HillChart, theme?: Partial<Theme>): string {
	return draw(chart, theme).svg;
}

/**
 * Draws a hill chart as a PNG at twice the SVG's size, with the embedded font only. Throws `HillChartError` on invalid
 * data or theme, on text the embedded font does not cover, and on a PNG over 50 megapixels.
 */
export async function renderPng(
	chart: HillChart,
	theme?: Partial<Theme>,
): Promise<Uint8Array> {
	const { data, viewBox, svg } = draw(chart, theme);
	return toPng(svg, data, viewBox);
}

/** Validates `chart` and `theme`, then draws the SVG, keeping the validated data and the SVG's viewBox. */
function draw(
	chart: HillChart,
	theme: Partial<Theme> | undefined,
): { data: HillChart; viewBox: Box; svg: string } {
	const data = readChart(chart);
	const resolved = readTheme(theme);
	const drawn = layout(data, resolved);
	return { data, viewBox: drawn.viewBox, svg: toSvg(drawn, resolved) };
}
