import { type HillChart, readChart, readTheme, type Theme } from "./input.ts";
import { layout } from "./layout.ts";
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
	const data = readChart(chart);
	const resolved = readTheme(theme);
	return toSvg(layout(data, resolved), resolved);
}

/**
 * Draws a hill chart as a PNG at twice the SVG's size, with the embedded font only. Throws `HillChartError` on invalid
 * data or theme, and on text the embedded font does not cover.
 */
export async function renderPng(
	chart: HillChart,
	theme?: Partial<Theme>,
): Promise<Uint8Array> {
	const data = readChart(chart);
	const resolved = readTheme(theme);
	return toPng(toSvg(layout(data, resolved), resolved), data);
}
