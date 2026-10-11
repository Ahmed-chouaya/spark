# Design

## Context

See `proposal.md` for motivation. The state that matters going forward:

`src/components/mascot/states/` currently holds eight components extracted from a
hand-packed 12-cell Figma sheet. The sheet's grid is irregular — column pitch 20.28 /
20.28 / 19.10, row pitch 17.52 / 18.79 — so the artwork inside each cell sits at a
different offset from its cell centre, and different states' artwork has genuinely
different extents. Each component was given a `viewBox` cropped to its own content, so
those offsets became baked into eight different box sizes.

Two structural facts constrain the approach: the artwork cannot be re-placed in this
change (no Figma edit), and the target is a Tauri web view, so the implementation is
whatever WebKit supports rather than anything platform-specific.

## Goals / Non-Goals

**Goals:**

- One canonical canvas so scale and registration are properties of the system rather than
  accidents of the source sheet.
- Anchors derived from the artwork, so a future re-export cannot silently reintroduce
  drift.
- Per-instance isolation of paint definitions and animatable parts.

**Non-Goals:**

- Correcting body geometry differences between states (see Decisions, residual).
- Source-artwork changes of any kind.
- Any behaviour beyond rendering and addressing — animation timing, state transitions and
  the agent event stream that drives state selection are separate work.

## Decisions

### One canonical canvas, superseding per-state tight crops

All nine states render into a single 21 x 15.2 unit canvas, positioned by a per-state
translation.

This explicitly reverses the "tight `viewBox` per state" instruction from the original
extraction brief. That instruction is what produced the rescale bug: a tight crop per
state means eight box sizes, and no sizing rule can hold across them.

*Alternative considered* — normalise each crop to equal width and accept differing
heights, sizing by height. Rejected: body heights still vary by 29%, so the character
would still visibly resize.

### Per-axis anchoring: X on the visor, Y on the ground line

The horizontal and vertical axes are anchored to different features, because the
artwork's relationship between body and floor is not consistent.

Measured offset of body centre from the floor-bar centre, per state:

| state | body cx - ground cx |
|---|---|
| thinking | -0.180 |
| idle | -0.265 |
| focused | -0.328 |
| working | -0.518 |
| tired | -0.772 |
| alert | -0.982 |
| listening | -1.335 |
| needsYou | -1.415 |
| success | -2.260 |

Spread 2.08 units. Anchoring X on the ground bar would swing the *face* across ~10% of
the canvas width — worst on the idle-to-success transition, which is among the most
frequent. Anchoring X on the visor centre collapses within-column spread to <=0.26 units:
the face never drifts, because the artwork does not drift it.

This is not fx clearance. The artwork's body-to-floor offset varies independently
of what it carries; `thinking` carries a dot trail and sits at -0.180, while
`alert` carries rays and sits at -0.982.

Consequence, accepted deliberately: floor bars land at cx 10.33-12.30 rather than a
uniform 10.5. That drift lands on a soft gradient glow at the feet, which is the right
place to spend it, rather than on the face.

**Anchor values:** visor centre x -> 10.5; floor line y -> 13.3.

*Alternative considered* — anchor both axes on the ground bar. Rejected: it trades a
scale bug for a position bug on the face.

### Canvas height 15.2, not 14.8

At 14.8 the tallest state clears the top edge by 0.37 units — about 2px at a 120px
render. 15.2 raises that to 0.77 units.

### Canvas width 21.3, not 21

The PAUSED cell carries a notification-bell badge whose right edge reaches 21.265
once its visor is anchored at 10.5, overflowing a 21-unit canvas. The original 21
figure rested on the "needsYou has no fx at all" assumption, which the extracted
artwork does not support — the cell has a bell badge and a three-dot trail. The
canvas grows rather than clipping, matching the same principle applied to height
above. Default height follows from the new aspect ratio: 82 x 15.2/21.3 ~ 58.5.

### Derive anchors at build time; do not hand-type them

An extraction step reads each state's artwork and emits per-state anchor data, consumed
by the components. Hand-entered numbers drift the moment the sheet is re-exported, and a
drifted anchor looks like a subtle art problem rather than a build problem.

### Three separate assertions, not one point

A single "every state lands at the same canonical point" check cannot hold, because X and
Y anchor to different features. Three assertions instead:

1. Ground ellipse `cy` lands at 13.3 (tolerance 0.1).
2. Visor centre `cx` lands at 10.5 (tolerance 0.3).
3. Every state's transformed content bounding box fits inside the canvas.

The third is what catches a re-export that makes `thinking` taller — the margin it has is
small enough that this is a live failure mode, not a theoretical one.

### Per-instance paint definitions

Gradient ids are currently per-state string literals, so a second mascot of the same
state duplicates them and document-wide lookup resolves to the first match.

They become per-instance using React's `useId()`, with non-alphanumeric characters
stripped — React 18 emits ids containing colons, which are awkward to embed in a `url(#...)`
reference.

*Alternative considered* — module-level deduplication so one definition is shared by all
instances of a state. Rejected: it keeps the ids global, so any lookup can still resolve
to the wrong instance, which is the failure we are removing.

### Parts addressed by data attribute and scoped query, not global id

Semantic groups become `data-part` attributes resolved by a scoped query against the
component's own root. Global ids are not used for parts at all.

This never collides, needs no id plumbing through the component, and matches the
convention already chosen in the original brief.

*Alternative considered* — `useId()` for groups too. Rejected: unnecessary plumbing; a
scoped query is simpler and has the same collision-immunity.

### Caller-supplied canvas declaration is not accepted

`viewBox` is omitted from the props type. With one canonical canvas, a caller-supplied
value can only break the contract, and TypeScript should reject it rather than letting it
silently clip the artwork.

### Component API

- Default width 82; default height derived from the canvas aspect ratio rather than
  hardcoded, so it cannot drift from the canvas (82 x 15.2/21 ~ 59).
- `role="img"` and the state-derived accessible name emitted once, in the wrapper. State
  components hardcoding them as well is redundant and duplicated across nine files.
- The unreachable `?? Idle` fallback in the state lookup is removed; the record is total
  and the state is typed, so the fallback implies a failure mode that cannot occur.

### Residual: body geometry is not corrected

Body extents vary independently of position — ~12% in width, ~29% in height, with
`focused` genuinely drawn shorter. No anchor removes this. Anchoring Y to the ground line
makes it read as squash-and-stretch against a planted floor, which is defensible.

If pixel-identical body geometry is ever required, that is a source-artwork correction,
not something the component layer can solve.

## Risks / Trade-offs

**Artwork drift between build and commit** → The extraction step re-runs and its output
is committed; a test re-derives from source and asserts equality, so a re-export that
moves the anchors fails the build instead of silently shifting every state.

**`thinking`'s small top margin** → Covered by containment assertion 3. If it ever trips,
the canvas grows; it does not clip.

**`needsYou` has no instant visual recognition at a glance** → The semantic slot
exists and the bell badge distinguishes it from `idle`, but both are otherwise
plain magenta bodies with open eyes. Accepted for v0.1 because the floor bar is
an independent channel that can carry the distinction. A Figma pass to
differentiate `needsYou`'s eyes is the natural follow-up and is out of scope
here.

**Success's floor bar is 25% narrower than every other state's** → Cosmetic once the
canvas is fixed, because the bar no longer influences box size. Leaving it keeps this
change free of artwork edits.

## Migration Plan

Self-contained frontend change with no persisted state and no API surface. Steps: derive
anchors, add `needsYou`, rename `shy` to `focused`, move all nine onto the canonical
canvas, switch ids, add assertions, update wrapper and exports.

Rollback is reverting the change. The one externally visible break is the state name
`shy` -> `focused`; since this code has not shipped, there is nothing downstream to
migrate.

## Open Questions

None. Deferred items — differentiating `needsYou`'s artwork, correcting `success`'s floor
bar, and correcting body geometry — are artwork tasks that do not alter the specs, the
approach, or the task breakdown decided here.