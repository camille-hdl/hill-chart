import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { getSystemErrorMessage, parseArgs } from "node:util";
import {
	type HillChart,
	HillChartError,
	renderPng,
	renderSvg,
	type Theme,
} from "./index.ts";

export type Io = {
	stdin: NodeJS.ReadableStream & { isTTY?: boolean };
	stdout: NodeJS.WritableStream & { isTTY?: boolean };
	stderr: NodeJS.WritableStream;
};

const help = `Usage: hill-chart [input.json|-] [-o out.svg|out.png] [--format svg|png] [--theme theme.json]

Draws a hill chart as SVG or PNG from a JSON description of a project's scopes.
Reads stdin when given no input file, or "-".

Options:
  -o, --output <file>  write to <file> instead of stdout, as SVG or PNG by its extension
      --format <fmt>   svg (default) or png; a PNG goes to stdout only when it is not a terminal
      --theme <file>   apply a partial theme read from a JSON file
  -h, --help           print this help
      --version        print the version

A PNG is twice the SVG's size and drawn with the embedded font only, so it looks the same on every
machine; text in a script the font lacks (Greek, Cyrillic, CJK, emoji) fails, and needs SVG.

Examples:
  hill-chart chart.json > chart.svg
  hill-chart chart.json -o chart.png --theme theme.json
  hill-chart chart.json --format png > chart.png
  cat chart.json | hill-chart -o chart.svg

Exit codes:
  0  success
  1  invalid JSON, data or theme, or text a PNG cannot draw; the message names the file, and the field when there is one
  2  usage error, or a file that cannot be read or written
`;

/** A failure to report on stderr, with the exit code it ends with. */
class Failure extends Error {
	readonly code: number;

	constructor(message: string, code: number) {
		super(message);
		this.code = code;
	}
}

/** Runs the `hill-chart` command and returns its exit code. Never calls `process.exit`. */
export async function run(args: string[], io: Io): Promise<number> {
	try {
		const { values, positionals } = parseCommandLine(args);
		if (values.help) {
			io.stdout.write(help);
			return 0;
		}
		if (values.version) {
			io.stdout.write(`${await packageVersion()}\n`);
			return 0;
		}
		const format = outputFormat(values.output, values.format);
		if (format === "png" && values.output === undefined && io.stdout.isTTY)
			throw new Failure(
				"refusing to write PNG to a terminal; use -o chart.png or redirect",
				2,
			);
		if (positionals.length === 0 && io.stdin.isTTY) {
			// Waiting for someone to type JSON would look like a hang.
			io.stderr.write(help);
			return 2;
		}
		const input = positionals[0] ?? "-";
		const source = input === "-" ? "<stdin>" : input;
		const data = parseJson(await readInput(input, io), source);
		const themeFile =
			values.theme === undefined
				? undefined
				: {
						theme: parseJson(await readFileText(values.theme), values.theme),
						path: values.theme,
					};
		const image = await draw(data, source, format, themeFile);
		if (values.output === undefined) io.stdout.write(image);
		else await writeOutput(values.output, image);
		return 0;
	} catch (error) {
		if (!(error instanceof Failure)) throw error;
		io.stderr.write(`hill-chart: ${error.message}\n`);
		return error.code;
	}
}

const options = {
	output: { type: "string", short: "o" },
	format: { type: "string" },
	theme: { type: "string" },
	help: { type: "boolean", short: "h" },
	version: { type: "boolean" },
} as const;

/** Parses `args`, and reports any mistake in them as a usage error. */
function parseCommandLine(args: string[]) {
	const parsed = parseStrictly(args);
	if (parsed.positionals.length > 1)
		throw usageError(
			`unexpected argument ${parsed.positionals[1]}; give at most one input file`,
		);
	return parsed;
}

function parseStrictly(args: string[]) {
	try {
		return parseArgs({ args, options, allowPositionals: true, strict: true });
	} catch (error) {
		if (!(error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS_"))
			throw error;
		throw usageError((error as Error).message);
	}
}

type Format = "svg" | "png";

/** The format to write: the extension of `output` decides, otherwise `format`, otherwise SVG. */
function outputFormat(
	output: string | undefined,
	format: string | undefined,
): Format {
	if (format !== undefined && !isFormat(format))
		throw usageError(
			`unknown format ${JSON.stringify(format)}; use svg or png`,
		);
	if (output === undefined) return format ?? "svg";
	const extension = extname(output).slice(1).toLowerCase();
	if (!isFormat(extension))
		throw usageError(
			`cannot tell the format of ${output}; name it .svg or .png`,
		);
	if (format !== undefined && format !== extension)
		throw usageError(`--format ${format} contradicts ${output}`);
	return extension;
}

function isFormat(name: string): name is Format {
	return name === "svg" || name === "png";
}

function usageError(message: string): Failure {
	return new Failure(`${message}\nTry hill-chart --help`, 2);
}

/** Read next to the module, so it works from `src/` as from `dist/`. */
async function packageVersion(): Promise<string> {
	const packageJson = new URL("../package.json", import.meta.url);
	return JSON.parse(await readFile(packageJson, "utf8")).version;
}

async function readInput(input: string, io: Io): Promise<string> {
	return input === "-" ? readLimited(io.stdin, "<stdin>") : readFileText(input);
}

async function readFileText(path: string): Promise<string> {
	try {
		return await readLimited(createReadStream(path), path);
	} catch (error) {
		if (error instanceof Failure) throw error;
		throw new Failure(`cannot read ${path}: ${systemReason(error)}`, 2);
	}
}

/** The most bytes of JSON read from a file or stdin: four times the largest chart the data limits allow. */
const MAX_INPUT_BYTES = 1024 * 1024;

/** Reads `stream`, coming from `source`, as UTF-8 text, and stops reading once it holds more than `MAX_INPUT_BYTES`. */
async function readLimited(
	stream: NodeJS.ReadableStream,
	source: string,
): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of stream) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > MAX_INPUT_BYTES)
			throw new Failure(
				`${source}: larger than the ${MAX_INPUT_BYTES / 1024 / 1024} MiB input limit`,
				1,
			);
		chunks.push(bytes);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

async function writeOutput(
	path: string,
	content: string | Uint8Array,
): Promise<void> {
	try {
		await writeFile(path, content);
	} catch (error) {
		throw new Failure(`cannot write ${path}: ${systemReason(error)}`, 2);
	}
}

function parseJson(json: string, source: string): unknown {
	try {
		return JSON.parse(json);
	} catch (error) {
		throw new Failure(
			`${source}: invalid JSON: ${(error as Error).message}`,
			1,
		);
	}
}

/**
 * Draws `data`, read from `source`, in `format` with the theme of `themeFile`, and reports each error against the file
 * it comes from.
 */
async function draw(
	data: unknown,
	source: string,
	format: Format,
	themeFile?: { theme: unknown; path: string },
): Promise<string | Uint8Array> {
	try {
		// Both render functions validate their input at runtime: data read from JSON is safe to pass as is.
		const chart = data as HillChart;
		const theme = themeFile?.theme as Partial<Theme>;
		return format === "png"
			? await renderPng(chart, theme)
			: renderSvg(chart, theme);
	} catch (error) {
		if (error instanceof HillChartError) {
			// Theme fields: `theme`, `theme.dot`, or `theme[""]` for a key a dot would garble.
			const file =
				themeFile && /^theme($|[.[])/.test(error.field)
					? themeFile.path
					: source;
			throw new Failure(`${file}: ${error.message}`, 1);
		}
		throw error;
	}
}

/** "no such file or directory" rather than Node's "ENOENT: no such file or directory, open '…'". */
function systemReason(error: unknown): string {
	const errno = (error as NodeJS.ErrnoException).errno;
	return errno === undefined ? String(error) : getSystemErrorMessage(errno);
}
