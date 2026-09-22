# A scope's position is one number in [0, 1] across the whole hill

Each scope carries a single `position`, from 0 (left foot) to 1 (finish), 0.5 at the top; a value out of bounds is rejected. One number is trivial to validate, and it avoids a 0–100 scale that reads as a percentage of tasks done, whereas the position is a judgment.

## Considered Options

- **[0, 100] across the whole hill**: friendlier to type by hand, but invites the “% done” reading.
- **Side + value** (`uphill|downhill 0–100`, as in mermaid-hillchart): matches the two phases, but needs two fields and is ambiguous at the top.
- The range of `position` in the Basecamp 3 API is undocumented (checked 2026-09-22): no scale guarantees reading a Basecamp export as is.
