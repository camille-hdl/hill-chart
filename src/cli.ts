import { readFile, writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { getSystemErrorMessage, parseArgs } from "node:util";
import {
	type HillChart,
	HillChartError,
	renderSvg,
	type Theme,
} from "./index.ts";

export type Io = {
	stdin: NodeJS.ReadableStream & { isTTY?: boolean };
	stdout: NodeJS.WritableStream & { isTTY?: boolean };
	stderr: NodeJS.WritableStream;
};

const help = `Usage: hill-chart [input.json|-] [-o out.svg] [--theme theme.json]

Draws a hill chart as SVG from a JSON description of a project's scopes.
Reads stdin when given no input file, or "-".

Options:
  -o, --output <file>  write the SVG to <file> instead of stdout
      --theme <file>   apply a partial theme read from a JSON file
  -h, --help           print this help
      --version        print the version

Examples:
  hill-chart chart.json > chart.svg
  hill-chart chart.json -o chart.svg --theme theme.json
  cat chart.json | hill-chart -o chart.svg

Exit codes:
  0  success
  1  invalid JSON, data or theme; the message names the file and the field
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
		const svg = draw(data, source, themeFile);
		if (values.output === undefined) io.stdout.write(svg);
		else await writeFileText(values.output, svg);
		return 0;
	} catch (error) {
		if (!(error instanceof Failure)) throw error;
		io.stderr.write(`hill-chart: ${error.message}\n`);
		return error.code;
	}
}

const options = {
	output: { type: "string", short: "o" },
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

function usageError(message: string): Failure {
	return new Failure(`${message}\nTry hill-chart --help`, 2);
}

/** Read next to the module, so it works from `src/` as from `dist/`. */
async function packageVersion(): Promise<string> {
	const packageJson = new URL("../package.json", import.meta.url);
	return JSON.parse(await readFile(packageJson, "utf8")).version;
}

async function readInput(input: string, io: Io): Promise<string> {
	return input === "-" ? text(io.stdin) : readFileText(input);
}

async function readFileText(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new Failure(`cannot read ${path}: ${systemReason(error)}`, 2);
	}
}

async function writeFileText(path: string, content: string): Promise<void> {
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

/** Draws `data`, read from `source`, with the theme of `themeFile`, and reports each error against the file it comes from. */
function draw(
	data: unknown,
	source: string,
	themeFile?: { theme: unknown; path: string },
): string {
	try {
		// renderSvg validates its input at runtime: data read from JSON is safe to pass as is.
		return renderSvg(data as HillChart, themeFile?.theme as Partial<Theme>);
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
