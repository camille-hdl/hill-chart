# Embedded font: Atkinson Hyperlegible Next, two static instances

The PNG is rendered with an embedded font, Atkinson Hyperlegible Next (OFL, `OFL.txt` shipped), as two static instances pinned at build time: 600 for names and subtitle, 700 for the title. Each instance keeps the font's full character coverage (~44 KB): no Latin-1 subsetting. The chart rule asks for a “friendly, readable font”, legible “without squinting”; Atkinson favors legibility at small sizes. The SVG puts it first in a named stack of system fonts.

## Consequences

- No variable font: `@resvg/resvg-js` 2.6.2 ignores the `wght` axis and renders the default instance (checked 2026-09-22: Atkinson at 400, Nunito at 200). Do not “optimize” to the variable file without checking the rasterizer.
- resvg silently drops any character missing from the fonts it is given (checked 2026-09-22: “Łódź” became “ód” with a Latin-1 subset). The full font covers extended Latin (~110 languages) but no Greek, Cyrillic, CJK or emoji. A PNG whose text contains an uncovered character is refused with an error naming the scope and characters, and suggesting SVG output; it never falls back to system fonts, so the PNG stays identical on every machine.

## Considered Options

- **Nunito**: rounder and “friendlier”, but visibly lighter at equal weight; names stand out less against the hill's stroke.
- **Latin-1 subset** (~29 KB per weight): 15 KB less, but drops Polish, Czech, Turkish… proper names.
- **System font fallback for uncovered characters**: 150 ms–1.4 s per render, machine-dependent output, holes anyway on a CI without fonts.
