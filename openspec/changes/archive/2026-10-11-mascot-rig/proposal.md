# Proposal

## Why

The eight mascot states extracted from the 12-cell source sheet were each given an
independently tight `viewBox`. Those crops do not share dimensions, so the mascot
rescales between roughly 53px and 80px of rendered height depending on which state is
active — every state change visibly resizes the character. Alongside that, gradient ids
are per-state string literals, so rendering more than one mascot in a document produces
duplicate ids; this silently breaks addressing of the `-body` / `-eyes` / `-fx` groups,
which is the sole purpose those groups were created to serve.

The extraction also left the vocabulary incomplete and partly misnamed: there is no state
for an agent that is blocked waiting on the user, and `shy` points at art that reads as
concentrated rather than shy.

## What Changes

- **BREAKING — supersedes the "tight `viewBox` per state" requirement from the original
  extraction brief.** That requirement is what produced the rescale bug. All states must
  render into one shared canonical canvas (21 x 15.2 units) via a per-axis translation
  derived at build time. A per-state tight crop must not be reintroduced, in whole or in
  part, by a later implementation pass.
- Introduce a ninth state, `needsYou`, drawn from the sheet's `NOTIFICATION` cell rather
  than `PAUSED`. It is the only state representing an agent that is stopped and waiting on
  the user. `PAUSED` was the original pick and is a plain body with no accessories at all —
  effectively indistinguishable from `idle`, which would defeat the one job this state has,
  which is instant recognition. `NOTIFICATION` carries a bell badge and dot trail, so the
  state reads as "something wants you" at a glance with no new artwork required.
  `PAUSED` remains unused.
- **BREAKING** — rename `shy` to `focused`. The cell it names (slanted eyes, strain marks)
  reads as concentrated, not shy; shipping a name that contradicts the art misleads
  whoever wires up "compact mode" later.
- Gradient ids become per-instance via React's `useId()`, with non-alphanumeric characters
  stripped (React 18 emits `:r0:`-style ids, which are awkward inside `url(#...)`).
- Semantic groups are addressed by `data-part` plus a scoped query against the component's
  own root, replacing globally-scoped `id` selectors.
- Anchor extraction is derived at build time from the artwork itself and enforced by three
  assertions: ground ellipse `cy` lands at the canonical floor line; visor centre `cx`
  lands at the canonical horizontal anchor; and every state's transformed content
  bounding box fits inside the canvas.
- Component API cleanup: omit `viewBox` from accepted props so callers cannot silently
  break the crop; supply default sizing derived from the canonical aspect; emit
  `role="img"` once in the wrapper; drop an unreachable fallback in the state lookup.

### Accepted residual

Body geometry varies between states independently of position — roughly a 12% spread in
width and a 29% spread in height, with the `focused` cell genuinely drawn shorter. No
anchor removes this. Anchoring the vertical axis to the ground ellipse leaves it reading
as squash-and-stretch against a planted floor line, which is accepted for v0.1. Pixel-identical
body geometry across all states is a source-art correction, out of scope here.

## Capabilities

### New Capabilities

- `mascot-rig`: the mascot's public state vocabulary, the canonical-canvas rendering
  contract that keeps states registered against one another, and the addressing scheme
  by which runtime code reaches a single mascot's animatable parts.

### Modified Capabilities

None. This project has no existing specs.

## Impact

- `src/components/mascot/states/` — all eight existing state components change to render
  into the canonical canvas; `Shy.tsx` becomes `Focused.tsx`; a new `NeedsYou.tsx` is
  added from the sheet's `NOTIFICATION` cell.
- `src/components/mascot/types.ts` — state list gains `needsYou`, drops `shy` for
  `focused`; props type omits `viewBox`.
- `src/components/mascot/Mascot.tsx` and `index.ts` — wrapper, defaults and exports.
- Build-time anchor derivation plus assertions guarding the canvas contract.
- No new runtime dependencies. Source artwork is unchanged; no Figma edit is required for
  this change to land.