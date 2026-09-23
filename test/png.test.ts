import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { Resvg } from "@resvg/resvg-wasm";
import {
	type HillChart,
	HillChartError,
	renderPng,
	renderSvg,
} from "../src/index.ts";

function fixture(name: string): HillChart {
	const url = new URL(`fixtures/${name}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8"));
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height from the IHDR chunk, which always follows the signature. */
function pngSize(png: Uint8Array): { width: number; height: number } {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	assert.equal(new TextDecoder().decode(png.subarray(12, 16)), "IHDR");
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

function viewBoxSize(svg: string): { width: number; height: number } {
	const [, , width, height] = (svg.match(/viewBox="([^"]*)"/)?.[1] ?? "").split(
		" ",
	);
	return { width: Number(width), height: Number(height) };
}

/** Compares bytes without `deepEqual`, whose diff of two large buffers takes minutes. */
function assertSameBytes(actual: Uint8Array, expected: Uint8Array) {
	assert.ok(Buffer.compare(actual, expected) === 0, "the bytes differ");
}

describe("renderPng", () => {
	// First in the file, so that both calls are the first to initialize the rasterizer: each test file runs in its own
	// process. It guards parallel rendering, but cannot catch an unshared initialization: resvg-wasm 2.6.2's `initWasm`
	// only throws once an init has finished. The sequential tests below catch that.
	test("draws the same PNG for concurrent first calls", async () => {
		const chart = fixture("sample");
		const [first, second] = await Promise.all([
			renderPng(chart),
			renderPng(chart),
		]);
		assertSameBytes(first, second);
	});

	test("draws a PNG twice the size of the SVG's viewBox", async () => {
		const chart = fixture("sample");
		const png = await renderPng(chart);
		assert.ok(png instanceof Uint8Array);
		assert.deepEqual([...png.subarray(0, 8)], PNG_SIGNATURE);
		const { width, height } = viewBoxSize(renderSvg(chart));
		assert.deepEqual(pngSize(png), { width: 2 * width, height: 2 * height });
	});

	test("draws the same bytes on every render", async () => {
		const chart = fixture("crowded");
		assertSameBytes(await renderPng(chart), await renderPng(chart));
	});

	test("frees the rasterizer's WebAssembly memory after each render", async (t) => {
		type Rasterizer = InstanceType<typeof Resvg>;
		// The declarations type `Resvg` as a bare constructor, without its prototype.
		const prototype = (Resvg as unknown as { prototype: Rasterizer }).prototype;
		const render = prototype.render;
		const rasterizerFree = t.mock.method(prototype, "free");
		const imageFrees: { mock: { callCount(): number } }[] = [];
		t.mock.method(prototype, "render", function (this: Rasterizer) {
			const image = render.call(this);
			imageFrees.push(t.mock.method(image, "free"));
			return image;
		});
		await renderPng(fixture("sample"));
		assert.equal(rasterizerFree.mock.callCount(), 1);
		assert.deepEqual(
			imageFrees.map((free) => free.mock.callCount()),
			[1],
		);
	});

	test("refuses the first name the embedded font does not cover, citing each character and suggesting SVG", async () => {
		await assert.rejects(renderPng(fixture("uncovered")), {
			name: "HillChartError",
			field: "scopes[1].name",
			message:
				'scopes[1].name: characters not in the embedded font: "👍" (U+1F44D), "✓" (U+2713); render SVG instead',
		});
	});

	test("checks the title, then the subtitle, before the names", async () => {
		const scopes = [{ name: "Ж", position: 0.5 }];
		await assert.rejects(
			renderPng({ title: "Ж", subtitle: "Ж", scopes }),
			(error) => error instanceof HillChartError && error.field === "title",
		);
		await assert.rejects(
			renderPng({ title: "Plan", subtitle: "Ж", scopes }),
			(error) => error instanceof HillChartError && error.field === "subtitle",
		);
	});

	test("still leaves uncovered text to the SVG", () => {
		assert.match(renderSvg(fixture("uncovered")), />Reactions 👍 and ✓ marks</);
	});
});

describe("the rasterizer", () => {
	test("is never loaded to draw an SVG, nor to refuse uncovered text", () => {
		// Runs in a fresh process, where resolving @resvg/resvg-wasm throws.
		const script = `
			import { registerHooks } from "node:module";
			registerHooks({
				resolve(specifier, context, next) {
					if (specifier.startsWith("@resvg/resvg-wasm")) throw new Error("resvg loaded");
					return next(specifier, context);
				},
			});
			const { renderSvg, renderPng } = await import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)});
			const chart = { scopes: [{ name: "Plot map", position: 0.3 }] };
			const outcome = (promise) => promise.then(() => "drawn", (error) => error.name + ": " + error.message);
			console.log(JSON.stringify([
				renderSvg(chart).startsWith("<svg "),
				await outcome(renderPng({ scopes: [{ name: "Ж", position: 0.3 }] })),
				await outcome(renderPng(chart)),
			]));
		`;
		const child = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", script],
			{ encoding: "utf8" },
		);
		assert.equal(child.status, 0, child.stderr);
		assert.deepEqual(JSON.parse(child.stdout), [
			true,
			'HillChartError: scopes[0].name: characters not in the embedded font: "Ж" (U+0416); render SVG instead',
			"Error: resvg loaded",
		]);
	});
});
