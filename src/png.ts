import { readFile } from "node:fs/promises";
import { fontFiles, uncovered } from "./font.ts";
import { codePoint, type HillChart, HillChartError } from "./input.ts";
import type { Box } from "./layout.ts";

type Resvg = typeof import("@resvg/resvg-wasm").Resvg;

/** The PNG is drawn at this multiple of the SVG's size. */
const ZOOM = 2;
/** The most pixels a PNG may have: rasterizing costs about 1.3 s and 0.6 GB at this size, and grows with it. */
const PIXEL_LIMIT = 50_000_000;

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

/** Rasterizes `svg`, drawn from `chart` within `viewBox`, at twice its size, with the embedded font only. */
export async function toPng(
	svg: string,
	chart: HillChart,
	viewBox: Box,
): Promise<Uint8Array> {
	checkCoverage(chart);
	checkPixelCount(viewBox);
	const Resvg = await loadRasterizer();
	const resvg = new Resvg(svg, {
		font: {
			fontBuffers: await fontFiles(),
			loadSystemFonts: false,
			defaultFontFamily: "Atkinson Hyperlegible Next",
		},
		fitTo: { mode: "zoom", value: ZOOM },
	});
	// Frees the WebAssembly memory now, rather than whenever the garbage collector runs the finalizers.
	try {
		const image = resvg.render();
		try {
			return image.asPng();
		} finally {
			image.free();
		}
	} finally {
		resvg.free();
	}
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

/** Throws when the PNG of `viewBox` would have more pixels than the limit, whatever made it so large. */
function checkPixelCount(viewBox: Box): void {
	const width = ZOOM * viewBox.width;
	const height = ZOOM * viewBox.height;
	if (width * height > PIXEL_LIMIT) {
		throw new HillChartError(
			"(root)",
			`PNG of ${width} × ${height} pixels is over the ${PIXEL_LIMIT / 1_000_000}-megapixel limit; use shorter texts, a smaller theme.fontSize or theme.width, or render SVG instead`,
		);
	}
}
