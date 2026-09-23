import { readFile } from "node:fs/promises";
import { fontFiles, uncovered } from "./font.ts";
import { codePoint, type HillChart, HillChartError } from "./input.ts";

type Resvg = typeof import("@resvg/resvg-wasm").Resvg;

let rasterizer: Promise<Resvg> | undefined;

/** Loads and initializes resvg on first call. Shared, since `initWasm` throws on a second call. */
function loadRasterizer(): Promise<Resvg> {
	rasterizer ??= (async () => {
		const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
		const wasm = new URL(
			import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"),
		);
		await initWasm(readFile(wasm));
		return Resvg;
	})();
	return rasterizer;
}

/** Rasterizes `svg`, drawn from `chart`, at twice its size, with the embedded font only. */
export async function toPng(
	svg: string,
	chart: HillChart,
): Promise<Uint8Array> {
	checkCoverage(chart);
	const Resvg = await loadRasterizer();
	const resvg = new Resvg(svg, {
		font: {
			fontBuffers: await fontFiles(),
			loadSystemFonts: false,
			defaultFontFamily: "Atkinson Hyperlegible Next",
		},
		fitTo: { mode: "zoom", value: 2 },
	});
	return resvg.render().asPng();
}

/** Throws on the first text, in document order, with characters the embedded font lacks: resvg would drop them. */
function checkCoverage(chart: HillChart): void {
	const texts: [string, string | undefined][] = [
		["title", chart.title],
		["subtitle", chart.subtitle],
		...chart.scopes.map((scope, i): [string, string] => [
			`scopes[${i}].name`,
			scope.name,
		]),
	];
	for (const [field, text] of texts) {
		const missing = uncovered(text ?? "");
		if (missing.length > 0) {
			const characters = missing
				.map((char) => `${JSON.stringify(char)} (${codePoint(char)})`)
				.join(", ");
			throw new HillChartError(
				field,
				`characters not in the embedded font: ${characters}; render SVG instead`,
			);
		}
	}
}
