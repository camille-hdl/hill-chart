import { type HillChart, readChart, readTheme, type Theme } from "./input.ts";
import { layout } from "./layout.ts";
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
