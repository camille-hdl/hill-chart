import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	closeSync,
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
import { renderSvg } from "../src/index.ts";

const samplePath = fileURLToPath(
	new URL("fixtures/sample.json", import.meta.url),
);
const sampleJson = readFileSync(samplePath, "utf8");
const sampleSvg = renderSvg(JSON.parse(sampleJson));

const dir = mkdtempSync(join(tmpdir(), "hill-chart-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function tempFile(name: string, content: string): string {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
}

/** Runs the CLI with fake streams, `stdin` holding the given text. */
async function runCli(args: string[], stdin = "") {
	const io = {
		stdin: Object.assign(new PassThrough(), { isTTY: false }),
		stdout: Object.assign(new PassThrough(), { isTTY: false }),
		stderr: new PassThrough(),
	};
	io.stdin.end(stdin);
	const code = await run(args, io);
	const read = (stream: PassThrough) => stream.read()?.toString() ?? "";
	return { code, stdout: read(io.stdout), stderr: read(io.stderr) };
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
		const dots: string[] = stdout.match(/<circle [^>]*>/g) ?? [];
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
