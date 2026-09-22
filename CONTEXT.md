# Hill chart

A package that draws a hill chart (Shape Up, ch. 13 “Show Progress”) from a description of a project's scopes.

## Language

### The chart

**Hill chart**:
An image of a hill where each scope of a project is a dot, placed according to its progress.
_Avoid_: diagram, progress chart

**Scope**:
A part of a project that can be built, integrated and finished independently of the rest, named in the project's own language.
_Avoid_: task, dot, item

**Name** (of a scope):
Non-empty text that identifies a scope, unique within a hill chart, shown next to its dot.
_Avoid_: label, title (reserved for the hill chart)

**Title** (of the hill chart):
Optional text heading the whole hill chart.

**Subtitle**:
Optional free text under the title, typically the date or project stage the hill chart captures.
_Avoid_: date (the package computes none)

**Position**:
Where a scope sits on the hill, a number from 0 (left foot) to 1 (finish), 0.5 at the top. A judgment, not a percentage of tasks done.
_Avoid_: progress, percentage, completion

**Uphill**:
The left half of the hill, position below 0.5: still figuring out what to do.
_Avoid_: phase 1

**Top**:
Position 0.5: now we know what to do.
_Avoid_: peak, summit

**Downhill**:
The right half of the hill, position above 0.5: only execution remains.
_Avoid_: phase 2

### Appearance

**Theme**:
The appearance choices of a hill chart (colors, text size, width, wobble seed), kept apart from the data. A partial theme completes the default theme.
_Avoid_: style, config

**ft-paper**:
Camille's palette (camillehdl.dev/palette), from which the default theme derives.

**Wobble**:
The irregularity of the hand-drawn strokes, drawn from a seed so that the same input always yields the same image.
_Avoid_: jitter, noise, roughness

**Axis**:
The discreet dotted vertical line marking the top; also the theme key that colors it.
_Avoid_: divider, midline

**Leader line**:
A thin stroke joining a scope's name to its dot, drawn only when the name had to move away from its dot.
_Avoid_: callout, connector

**Embedded font**:
The font shipped in the package, as two static instances, used to measure text and to draw every PNG.
_Avoid_: bundled font, default font
