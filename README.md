# @camille-hdl/hill-chart

Draws a minimalist, hand-drawn hill chart, as in [Shape Up, chapter 13 “Show Progress”](https://basecamp.com/shapeup/3.4-chapter-13),
from a JSON list of scopes, to SVG or PNG.

![A hill chart of a community garden planner: nine scopes as dots on a hand-drawn hill, each with its name](https://raw.githubusercontent.com/camille-hdl/hill-chart/main/docs/hill-chart.png)

## Quick start

Write your scopes to `chart.json`:

```json
{
  "scopes": [
    { "name": "Plot map", "position": 0.2 },
    { "name": "Watering schedule", "position": 0.5 },
    { "name": "Login", "position": 0.9 }
  ]
}
```

Then draw it:

```sh
npx @camille-hdl/hill-chart chart.json -o chart.png
```

## Data format

```json
{
  "title": "Community garden planner",
  "subtitle": "Week 12",
  "scopes": [
    { "name": "Plot map", "position": 0.08 },
    { "name": "Harvest log", "position": 0.5 },
    { "name": "Tool library", "position": 0.74 }
  ]
}
```

A scope's **position** is a judgment, not a percentage of tasks done. It runs from 0 (left foot) to 1 (finish):

- below 0.5, **uphill**: the team is still figuring out what to do;
- 0.5, the **top**: now it knows what to do;
- above 0.5, **downhill**: only execution is left.

The rules:

- `scopes` is required. An empty array draws the hill alone.
- A scope has only `name` and `position`. Any other key is an error, including `label` and `color`: every dot takes the
  theme's color.
- `position` is a number from 0 to 1, both included. `70` instead of `0.7` is an error, not a dot off the chart.
- `name` is unique within the chart. Two scopes may share a position.
- `title` and `subtitle` are optional. The package never adds a date: put it in `subtitle` if you want one.
- Text is cleaned up before drawing: Unicode is normalized (NFC), runs of spaces and line breaks become one space, and
  the ends are trimmed. Names are compared after that, so `"Reply"` and `" Reply "` are duplicates.
- A name, title or subtitle that is empty after that, or holds a control character, is an error.
- No other key is allowed at the root.

Only the first error is reported, and it names the field:

```
hill-chart: chart.json: scopes[2].position: must be a number from 0 to 1, got 70
```

## CLI

```
$ npx @camille-hdl/hill-chart --help
Usage: hill-chart [input.json|-] [-o out.svg|out.png] [--format svg|png] [--theme theme.json]

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
```

- **Input**: a file, or stdin with no file or with `-`. Run with no file in a terminal, it prints the help on stderr
  and exits 2 instead of waiting for input.
- **Output**: SVG on stdout, unless `-o` says otherwise. The extension of `-o` (`.svg` or `.png`, any case) sets the
  format; a `--format` that contradicts it is a usage error.
- **PNG to a terminal**: refused, with exit code 2:
  `hill-chart: refusing to write PNG to a terminal; use -o chart.png or redirect`.
- **Messages** go to stderr, start with `hill-chart: ` and name the file at fault: the theme file for an error in the
  theme.

Installed in a project (`npm install @camille-hdl/hill-chart`), the command is `hill-chart`.

## Theme

A theme is a flat JSON object. Give only the keys you change; the others keep their default. For example, in
`theme.json`:

```json
{ "background": "transparent", "dot": "#0f5499", "seed": 7 }
```

```sh
npx @camille-hdl/hill-chart chart.json -o chart.png --theme theme.json
```

| Key | Default | Accepts | Colors or sets |
| --- | --- | --- | --- |
| `background` | `"#fff1e5"` | `#rgb`, `#rrggbb` or `"transparent"` | the background; `"transparent"` draws none |
| `ink` | `"#262a33"` | `#rgb` or `#rrggbb` | hill, names, title |
| `muted` | `"#6b6259"` | `#rgb` or `#rrggbb` | subtitle, leader lines |
| `dot` | `"#990f3d"` | `#rgb` or `#rrggbb` | dots |
| `axis` | `"#b8afa5"` | `#rgb` or `#rrggbb` | the axis, a dotted line at the top |
| `fontSize` | `18` | a number from 6 to 96 | size of names and subtitle; the title is 1.5× |
| `width` | `960` | a number from 200 to 4000 | width of the hill, foot to finish |
| `seed` | `1` | an integer from 0 to 4294967295 | the hand-drawn wobble |

- `width` is the hill's width, not the image's: the image grows around the hill to fit the names, so the spacing of
  your dots never depends on how long their names are.
- `seed` picks one hand-drawn look among many. Try a few, keep the one you like.
- Unknown keys and out-of-range values are errors.

The defaults ship in the package as `default-theme.json`, to copy and edit. Once installed, it is
`node_modules/@camille-hdl/hill-chart/default-theme.json`, or from JavaScript:

```js
import defaultTheme from "@camille-hdl/hill-chart/default-theme.json" with { type: "json" };
```

## API

```sh
npm install @camille-hdl/hill-chart
```

```js
import { writeFile } from "node:fs/promises";
import { HillChartError, renderPng, renderSvg } from "@camille-hdl/hill-chart";

const chart = {
  title: "Community garden planner",
  scopes: [
    { name: "Plot map", position: 0.08 },
    { name: "Tool library", position: 0.74 },
  ],
};

const svg = renderSvg(chart); // a string
await writeFile("chart.svg", svg);
await writeFile("chart.png", await renderPng(chart, { seed: 7 })); // a Uint8Array

try {
  renderSvg({ scopes: [{ name: "Login", position: 70 }] });
} catch (error) {
  if (!(error instanceof HillChartError)) throw error;
  console.error(error.field); // scopes[0].position
}
```

- `renderSvg(chart, theme?)` returns the SVG, synchronously.
- `renderPng(chart, theme?)` returns a `Promise<Uint8Array>`. The PNG rasterizer (WebAssembly) loads on the first call
  only, so SVG-only use never loads it.
- Both validate their input at runtime, so JSON read from a file is safe to pass as is. They never modify the objects
  you pass.
- Invalid data or theme throws a `HillChartError`, and so does text the PNG's font lacks. Its `field` is the path at
  fault, like `scopes[0].position` or `theme.dot`; its message is `<field>: <reason>`.
- The types `HillChart`, `Scope` and `Theme` are exported for TypeScript.

The package is ESM only.

## Determinism

The same data and theme always give the same image, byte for byte, in SVG and in PNG.

A hill chart is read against the previous one, so each part of the drawing has its own wobble. The hill's depends only
on the theme; a dot's, on the theme and its scope's name and position. Add, remove or reorder scopes: the hill and every
other dot keep exactly the same drawing, and the dots that changed are the ones that moved. Names may shift to make
room for each other, and the image's edges may grow to fit a longer name.

## Fonts

- **PNG** is drawn with the embedded font, [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/),
  and nothing else, so it looks the same on every machine. It covers Latin, including extended Latin such as “Łódź” or
  “İstanbul”. Greek, Cyrillic, CJK, emoji and symbols such as ✓ are not covered: the PNG fails with an error naming the
  field and the characters. Use SVG for those.
- **SVG** is drawn by whatever opens it, with this font stack:
  `'Atkinson Hyperlegible Next', Avenir, 'Segoe UI', Seravek, Ubuntu, Calibri, 'DejaVu Sans', sans-serif`.
  Names get room to spare, since the fallback fonts may be wider.

## Requirements

- Node ≥ 22.14 to use the package.
- Node ≥ 22.18 to develop it: the tests run the TypeScript sources directly, without a build.

## Development

```sh
npm install
npm test               # run the tests on the TypeScript sources
npm run test:update    # rewrite the SVG snapshots in test/snapshots/, then review them as images
npm run check          # format, lint and type-check
npm run build-font     # regenerate the embedded font; needs the network and HarfBuzz
```

After a rendering change, redraw the example image above:

```sh
node src/bin.ts test/fixtures/sample.json -o docs/hill-chart.png
```

## Releasing

```sh
npm version minor      # or patch, or major
git push --follow-tags
```

The tag's workflow publishes to npm with provenance and creates the GitHub release.

## License

The code is under [0BSD](https://github.com/camille-hdl/hill-chart/blob/main/LICENSE). The embedded font, Atkinson
Hyperlegible Next, is under the [SIL Open Font License 1.1](https://github.com/camille-hdl/hill-chart/blob/main/fonts/OFL.txt).
