import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.ts";
import { renderPng, renderSvg } from "../src/index.ts";

const samplePath = fileURLToPath(
	new URL("fixtures/sample.json", import.meta.url),
);
const sampleJson = readFileSync(samplePath, "utf8");
const sampleSvg = renderSvg(JSON.parse(sampleJson));
const samplePng = await renderPng(JSON.parse(sampleJson));

const dir = mkdtempSync(join(tmpdir(), "hill-chart-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function tempFile(name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

/** Which fake streams claim to be a terminal. */
type Terminal = { stdin?: boolean; stdout?: boolean };

/** Runs the CLI with fake streams, `stdin` holding the given text, and returns what it wrote as bytes. */
async function runCliBytes(
	args: string[],
	stdin = "",
	terminal: Terminal = {},
) {
	const io = {
		stdin: Object.assign(new PassThrough(), { isTTY: terminal.stdin ?? false }),
		stdout: Object.assign(new PassThrough(), {
			isTTY: terminal.stdout ?? false,
		}),
		stderr: new PassThrough(),
	};
	io.stdin.end(stdin);
	const code = await run(args, io);
	const read = (stream: PassThrough): Buffer =>
		stream.read() ?? Buffer.alloc(0);
	return { code, stdout: read(io.stdout), stderr: read(io.stderr) };
}

/** Runs the CLI with fake streams, `stdin` holding the given text, and returns what it wrote as text. */
async function runCli(args: string[], stdin = "", terminal: Terminal = {}) {
	const { code, stdout, stderr } = await runCliBytes(args, stdin, terminal);
	return { code, stdout: stdout.toString(), stderr: stderr.toString() };
}

describe("run", () => {
	test("prints the SVG of a JSON file", async () => {
		assert.deepEqual(await runCli([samplePath]), {
			code: 0,
			stdout: sampleSvg,
			stderr: "",
		});
	});

	test("reads stdin when given no file", async () => {
		assert.deepEqual(await runCli([], sampleJson), {
			code: 0,
			stdout: sampleSvg,
			stderr: "",
		});
	});

	test('reads stdin when given "-"', async () => {
		assert.deepEqual(await runCli(["-"], sampleJson), {
			code: 0,
			stdout: sampleSvg,
			stderr: "",
		});
	});

	test("writes the SVG to the -o file and prints nothing", async () => {
		const output = join(dir, "chart.svg");
		assert.deepEqual(await runCli([samplePath, "-o", output]), {
			code: 0,
			stdout: "",
			stderr: "",
		});
		assert.equal(readFileSync(output, "utf8"), sampleSvg);
	});

	test("exits 1 on invalid JSON from stdin", async () => {
		const { code, stdout, stderr } = await runCli([], "{");
		assert.equal(code, 1);
		assert.equal(stdout, "");
		assert.match(stderr, /^hill-chart: <stdin>: invalid JSON: \S.*\n$/);
	});

	test("exits 1 on invalid JSON in a file, naming the file", async () => {
		const path = tempFile("broken.json", '{"scopes": [,]}');
		const { code, stderr } = await runCli([path]);
		assert.equal(code, 1);
		assert.ok(stderr.startsWith(`hill-chart: ${path}: invalid JSON: `), stderr);
	});

	const invalidData: [string, string][] = [
		[
			"label",
			'scopes[0].label: unknown key; a scope has only "name" and "position"',
		],
		[
			"color",
			'scopes[0].color: unknown key; a scope has only "name" and "position"',
		],
		[
			"duplicate-name",
			'scopes[2].name: duplicate name "Reply" (same as scopes[0])',
		],
		[
			"position-out-of-bounds",
			"scopes[0].position: must be a number from 0 to 1, got 70",
		],
		["control-character", "scopes[0].name: contains control character U+0007"],
		["missing-scopes", "scopes: required"],
		["empty-subtitle", "subtitle: must not be empty (omit it instead)"],
	];

	for (const [name, error] of invalidData) {
		test(`exits 1 on the ${name} data file, naming the file and the field`, async () => {
			const path = fileURLToPath(
				new URL(`fixtures/invalid/${name}.json`, import.meta.url),
			);
			assert.deepEqual(await runCli([path]), {
				code: 1,
				stdout: "",
				stderr: `hill-chart: ${path}: ${error}\n`,
			});
		});
	}

	test("draws text normalized, from stdin", async () => {
		const { code, stdout } = await runCli(
			[],
			'{"scopes":[{"name":"A\\n  B","position":0.5}]}',
		);
		assert.equal(code, 0);
		assert.match(stdout, /<desc>A B: top, 0\.5\.<\/desc>/);
	});

	test("exits 1 on invalid data from stdin", async () => {
		const { code, stderr } = await runCli([], "{}");
		assert.equal(code, 1);
		assert.equal(stderr, "hill-chart: <stdin>: scopes: required\n");
	});

	const themePath = (name: string) =>
		fileURLToPath(new URL(`fixtures/themes/${name}.json`, import.meta.url));

	test("draws with the --theme file, without a background when transparent", async () => {
		const { code, stdout, stderr } = await runCli([
			samplePath,
			"--theme",
			themePath("transparent"),
		]);
		assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
		assert.equal(
			stdout,
			renderSvg(JSON.parse(sampleJson), { background: "transparent" }),
		);
		assert.doesNotMatch(stdout, /<rect/);
	});

	test("draws dots in the --theme color, lowercased", async () => {
		const { code, stdout } = await runCli([
			samplePath,
			"--theme",
			themePath("uppercase-dot"),
		]);
		assert.equal(code, 0);
		const dots: string[] =
			stdout.match(/(?<=<g class="scope">\s*)<path [^>]*>/g) ?? [];
		assert.equal(dots.length, 9);
		assert.ok(
			dots.every((dot) => dot.includes(' fill="#abc"')),
			dots[0],
		);
	});

	test("applies the --theme file to data from stdin", async () => {
		const { code, stdout } = await runCli(
			["--theme", themePath("transparent")],
			sampleJson,
		);
		assert.equal(code, 0);
		assert.doesNotMatch(stdout, /<rect/);
	});

	const invalidThemes: [string, string][] = [
		[
			"named-color",
			'theme.dot: expected a hex color like "#990f3d", got "red"',
		],
		[
			"misspelled-key",
			'theme.backgroud: unknown key; a theme has only "background", "ink", "muted", "dot", "axis", "fontSize", "width" and "seed"',
		],
		["narrow-width", "theme.width: must be a number from 200 to 4000, got 100"],
		[
			"large-font-size",
			"theme.fontSize: must be a number from 6 to 96, got 100",
		],
		[
			"fractional-seed",
			"theme.seed: must be an integer from 0 to 4294967295, got 1.5",
		],
		[
			"negative-seed",
			"theme.seed: must be an integer from 0 to 4294967295, got -1",
		],
		["array", "theme: expected an object"],
	];

	for (const [name, error] of invalidThemes) {
		test(`exits 1 on the ${name} theme file, naming the theme file and the field`, async () => {
			const path = themePath(`invalid/${name}`);
			assert.deepEqual(await runCli([samplePath, "--theme", path]), {
				code: 1,
				stdout: "",
				stderr: `hill-chart: ${path}: ${error}\n`,
			});
		});
	}

	test("names the theme file on an invalid theme with data from stdin", async () => {
		const path = themePath("invalid/named-color");
		const { code, stderr } = await runCli(["--theme", path], sampleJson);
		assert.equal(code, 1);
		assert.ok(stderr.startsWith(`hill-chart: ${path}: theme.dot: `), stderr);
	});

	test("names the theme file on a theme key cited in brackets", async () => {
		const path = tempFile("empty-key-theme.json", '{"":1}');
		const { code, stderr } = await runCli([samplePath, "--theme", path]);
		assert.equal(code, 1);
		assert.ok(stderr.startsWith(`hill-chart: ${path}: theme[""]: `), stderr);
	});

	test("names the data file on invalid data with a valid theme", async () => {
		const path = fileURLToPath(
			new URL("fixtures/invalid/label.json", import.meta.url),
		);
		const { code, stderr } = await runCli([
			path,
			"--theme",
			themePath("transparent"),
		]);
		assert.equal(code, 1);
		assert.ok(
			stderr.startsWith(`hill-chart: ${path}: scopes[0].label: `),
			stderr,
		);
	});

	test('names the data file on an unknown "theme" key in the data, without --theme', async () => {
		const { code, stderr } = await runCli([], '{"scopes":[],"theme":{}}');
		assert.equal(code, 1);
		assert.ok(
			stderr.startsWith("hill-chart: <stdin>: theme: unknown key"),
			stderr,
		);
	});

	test("exits 1 on invalid JSON in the theme file, naming the theme file", async () => {
		const path = tempFile("broken-theme.json", "{");
		const { code, stdout, stderr } = await runCli([
			samplePath,
			"--theme",
			path,
		]);
		assert.equal(code, 1);
		assert.equal(stdout, "");
		assert.match(
			stderr,
			/^hill-chart: \S+broken-theme\.json: invalid JSON: \S.*\n$/,
		);
		assert.ok(stderr.startsWith(`hill-chart: ${path}: invalid JSON: `), stderr);
	});

	test("exits 2 on a theme file it cannot read", async () => {
		const path = join(dir, "no-theme.json");
		const { code, stdout, stderr } = await runCli([
			samplePath,
			"--theme",
			path,
		]);
		assert.equal(code, 2);
		assert.equal(stdout, "");
		assert.match(stderr, /^hill-chart: cannot read \S+no-theme\.json: .+\n$/);
	});

	test("exits 2 on an -o file it cannot write", async () => {
		const output = join(dir, "no-such-dir", "chart.svg");
		const { code, stdout, stderr } = await runCli([samplePath, "-o", output]);
		assert.equal(code, 2);
		assert.equal(stdout, "");
		assert.equal(
			stderr,
			`hill-chart: cannot write ${output}: no such file or directory\n`,
		);
	});

	test("exits 2 on a file it cannot read", async () => {
		const path = join(dir, "does-not-exist.json");
		const { code, stdout, stderr } = await runCli([path]);
		assert.equal(code, 2);
		assert.equal(stdout, "");
		assert.match(
			stderr,
			/^hill-chart: cannot read \S+does-not-exist\.json: .+\n$/,
		);
	});
});

describe("run, on help, version and usage errors", () => {
	for (const flag of ["--help", "-h"]) {
		test(`prints the help on stdout with ${flag}`, async () => {
			const { code, stdout, stderr } = await runCli([flag]);
			assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
			assert.match(stdout, /^Usage: hill-chart \[input\.json\|-\]/);
			for (const option of [
				"-o, --output",
				"--format",
				"--theme",
				"-h, --help",
				"--version",
			]) {
				assert.ok(stdout.includes(option), option);
			}
			assert.match(stdout, /^Usage: .*\[--format svg\|png\]/);
			assert.match(stdout, /\nExamples:\n(.+\n)*.*-o chart\.png/);
			assert.match(stdout, /\nExit codes:\n +0 .+\n +1 .+\n +2 .+\n$/);
			assert.match(stdout, /\n +1 .+, and the field when there is one\n/);
		});
	}

	test("prints the bare version from package.json with --version", async () => {
		const { version } = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		);
		assert.deepEqual(await runCli(["--version"]), {
			code: 0,
			stdout: `${version}\n`,
			stderr: "",
		});
	});

	const usageErrors: [string, string[]][] = [
		["an unknown option", ["--nope"]],
		["a missing option value", [samplePath, "-o"]],
		["a second positional argument", ["a.json", "b.json"]],
	];

	for (const [name, args] of usageErrors) {
		test(`exits 2 on ${name}, pointing to --help`, async () => {
			const { code, stdout, stderr } = await runCli(args, sampleJson);
			assert.deepEqual({ code, stdout }, { code: 2, stdout: "" });
			assert.match(stderr, /^hill-chart: \S.*\nTry hill-chart --help\n$/);
		});
	}

	test("prints the help on stderr and exits 2 when given no file and stdin is a terminal", async () => {
		const [{ stdout: help }, noFile] = await Promise.all([
			runCli(["--help"]),
			runCli([], sampleJson, { stdin: true }),
		]);
		assert.deepEqual(noFile, { code: 2, stdout: "", stderr: help });
	});

	test("prints the help on stdout and exits 0 with --help, even when stdin is a terminal", async () => {
		const { code, stdout, stderr } = await runCli(["--help"], "", {
			stdin: true,
		});
		assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
		assert.match(stdout, /^Usage: hill-chart /);
	});

	test("prints the help rather than the version with --version --help", async () => {
		const [{ stdout: help }, both] = await Promise.all([
			runCli(["--help"]),
			runCli(["--version", "--help"]),
		]);
		assert.deepEqual(both, { code: 0, stdout: help, stderr: "" });
	});

	test('reads stdin when given "-", even when stdin is a terminal', async () => {
		assert.deepEqual(await runCli(["-"], sampleJson, { stdin: true }), {
			code: 0,
			stdout: sampleSvg,
			stderr: "",
		});
	});
});

/** Compares bytes without `deepEqual`, whose diff of two large buffers takes minutes. */
function assertSamePng(actual: Uint8Array) {
	assert.ok(
		Buffer.compare(actual, samplePng) === 0,
		`not the PNG of the sample: ${actual.length} bytes, expected ${samplePng.length}`,
	);
}

describe("run, on PNG output", () => {
	test("writes a PNG to an -o file ending in .png", async () => {
		const output = join(dir, "chart.png");
		assert.deepEqual(await runCli([samplePath, "-o", output]), {
			code: 0,
			stdout: "",
			stderr: "",
		});
		assertSamePng(readFileSync(output));
	});

	test("reads the -o extension regardless of case", async () => {
		const output = join(dir, "CHART.PNG");
		const { code } = await runCli([samplePath, "-o", output]);
		assert.equal(code, 0);
		assertSamePng(readFileSync(output));
	});

	const formatErrors: [string, string[], string][] = [
		[
			"an -o extension other than .svg or .png",
			["-o", join(dir, "chart.txt")],
			`cannot tell the format of ${join(dir, "chart.txt")}; name it .svg or .png`,
		],
		[
			"an -o file without extension",
			["-o", join(dir, "chart")],
			`cannot tell the format of ${join(dir, "chart")}; name it .svg or .png`,
		],
		[
			"an unknown --format",
			["--format", "gif"],
			'unknown format "gif"; use svg or png',
		],
		[
			"a --format that contradicts -o",
			["-o", join(dir, "contradiction.svg"), "--format", "png"],
			`--format png contradicts ${join(dir, "contradiction.svg")}`,
		],
	];

	for (const [name, args, message] of formatErrors) {
		test(`exits 2 on ${name}, pointing to --help`, async () => {
			assert.deepEqual(await runCli([samplePath, ...args]), {
				code: 2,
				stdout: "",
				stderr: `hill-chart: ${message}\nTry hill-chart --help\n`,
			});
		});
	}

	test("prints the PNG with --format png when stdout is not a terminal", async () => {
		const { code, stdout, stderr } = await runCliBytes([
			samplePath,
			"--format",
			"png",
		]);
		assert.deepEqual(
			{ code, stderr: stderr.toString() },
			{ code: 0, stderr: "" },
		);
		assertSamePng(stdout);
	});

	test("refuses to print a PNG when stdout is a terminal", async () => {
		assert.deepEqual(
			await runCli([samplePath, "--format", "png"], "", { stdout: true }),
			{
				code: 2,
				stdout: "",
				stderr:
					"hill-chart: refusing to write PNG to a terminal; use -o chart.png or redirect\n",
			},
		);
	});

	test("writes the PNG to -o even when stdout is a terminal", async () => {
		const output = join(dir, "from-terminal.png");
		const { code } = await runCli([samplePath, "-o", output], "", {
			stdout: true,
		});
		assert.equal(code, 0);
		assertSamePng(readFileSync(output));
	});

	test("accepts a --format that agrees with -o", async () => {
		const output = join(dir, "agreed.png");
		const { code } = await runCli([
			samplePath,
			"-o",
			output,
			"--format",
			"png",
		]);
		assert.equal(code, 0);
		assertSamePng(readFileSync(output));
	});

	test("prints the SVG with --format svg", async () => {
		assert.deepEqual(await runCli([samplePath, "--format", "svg"]), {
			code: 0,
			stdout: sampleSvg,
			stderr: "",
		});
	});

	const uncoveredPath = fileURLToPath(
		new URL("fixtures/uncovered.json", import.meta.url),
	);

	test("exits 1 on a name the embedded font does not cover, naming the file, and writes nothing", async () => {
		const output = join(dir, "uncovered.png");
		assert.deepEqual(await runCli([uncoveredPath, "-o", output]), {
			code: 1,
			stdout: "",
			stderr: `hill-chart: ${uncoveredPath}: scopes[1].name: characters not in the embedded font: "👍" (U+1F44D), "✓" (U+2713); render SVG instead\n`,
		});
		assert.equal(existsSync(output), false);
	});

	test("exits 1 on a PNG over the pixel limit, naming the data file, and writes nothing", async () => {
		const input = tempFile(
			"oversized.json",
			JSON.stringify({ title: "W".repeat(200), scopes: [] }),
		);
		const theme = tempFile("large-text.json", '{"fontSize":96}');
		const output = join(dir, "oversized.png");
		assert.deepEqual(await runCli([input, "--theme", theme, "-o", output]), {
			code: 1,
			stdout: "",
			stderr: `hill-chart: ${input}: (root): PNG of 61626 × 1416 pixels is over the 50-megapixel limit; use shorter texts, a smaller theme.fontSize or theme.width, or render SVG instead\n`,
		});
		assert.equal(existsSync(output), false);
	});

	test("still prints the SVG of a name the embedded font does not cover", async () => {
		const { code, stdout, stderr } = await runCli([uncoveredPath]);
		assert.deepEqual({ code, stderr }, { code: 0, stderr: "" });
		assert.match(stdout, /^<svg /);
	});

	test("writes nothing to an -o file whose format is contradicted", async () => {
		const output = join(dir, "not-written.svg");
		await runCli([samplePath, "-o", output, "--format", "png"]);
		assert.equal(existsSync(output), false);
	});
});

describe("hill-chart executable", () => {
	test("prints the SVG of JSON redirected to its stdin", () => {
		const stdin = openSync(samplePath, "r");
		try {
			const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
			const child = spawnSync(process.execPath, [bin], {
				stdio: [stdin, "pipe", "pipe"],
				encoding: "utf8",
			});
			assert.deepEqual(
				{ status: child.status, stdout: child.stdout, stderr: child.stderr },
				{ status: 0, stdout: sampleSvg, stderr: "" },
			);
		} finally {
			closeSync(stdin);
		}
	});
});
