# The wobble comes from a fixed seed, split per element

The hill's strokes depend only on the theme's seed (`seed`, fixed default); each dot's wobble depends on the seed combined with its scope's name. A hill chart is read against the previous update: the hill must stay identical to the pixel, and a scope that has not moved must keep exactly the same drawing, whatever scopes are added, removed or reordered. Do not “simplify” into a single random stream consumed in scope order.

## Considered Options

- **A single stream with a fixed seed** (LDP prototype): adding or reordering a scope redraws every following dot.
- **A seed derived from the data** (hash of the JSON): the hill changes shape at every update and blurs the reading of movement.
