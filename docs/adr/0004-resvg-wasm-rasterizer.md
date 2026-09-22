# PNG goes through `@resvg/resvg-wasm`, as a regular dependency

The only rasterizer is `@resvg/resvg-wasm` 2.6.2, in `dependencies`, loaded by dynamic `import()` only when a PNG is requested. So `npx @camille-hdl/hill-chart … -o chart.png` works on the first try, with a single 2.5 MB package, no native binary and no platform left out. Fonts are passed to it as buffers (ADR 0003), which it requires.

## Considered Options

- **`@resvg/resvg-js` as an optional `peerDependency`** (the research's recommendation): zero-dependency core, but `npx` fails without `-p @resvg/resvg-js`, a poor first contact when PNG is the most shared output.
- **`@resvg/resvg-js` as a regular dependency**: 18 ms render instead of ~125 ms, but 2 packages and a 3.5–4.5 MB native binary per platform. The gap disappears in `npx` startup (~200 ms warm, measured 2026-09-22).
