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
	const { values, positionals } = parseArgs({
		args,
		options: {
			output: { type: "string", short: "o" },
			theme: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});
	const input = positionals[0] ?? "-";
	const source = input === "-" ? "<stdin>" : input;
	try {
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
		else await writeFile(values.output, svg);
		return 0;
	} catch (error) {
		if (!(error instanceof Failure)) throw error;
		io.stderr.write(`hill-chart: ${error.message}\n`);
		return error.code;
	}
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
