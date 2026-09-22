export type Weight = 600 | 700;

export const FONT_FAMILY =
	"'Atkinson Hyperlegible Next', Avenir, 'Segoe UI', Seravek, Ubuntu, Calibri, 'DejaVu Sans', sans-serif";

/** Width of `text` in px. Stub: 0.6 em per character until the embedded font lands. */
export function measure(
	text: string,
	_weight: Weight,
	fontSize: number,
): number {
	return [...text].length * 0.6 * fontSize;
}

/** Breaks `text` into lines no wider than `maxWidth`. Stub: always one line. */
export function wrap(
	text: string,
	_maxWidth: number,
	_weight: Weight,
	_fontSize: number,
): string[] {
	return [text];
}
