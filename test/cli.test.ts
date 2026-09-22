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
