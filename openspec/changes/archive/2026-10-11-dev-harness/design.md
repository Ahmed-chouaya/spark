# Design

## Context

See `proposal.md` for motivation. Two constraints shape the approach: the mascot library
is finished and must not be touched, and the harness is scaffolding for a companion that
does not exist yet — so it has to be cheap to maintain and cheap to throw away.

`e2e.config.ts` already points at `http://localhost:3000` with its dev-server command
commented out, which fixes the address and tells us an automated run is meant to reach this
surface.

## Goals / Non-Goals

**Goals:**

- Every state visible at once, and one state addressable on its own.
- Legible at small size, because "does this read at a glance" is a small-size question.
- Nothing that could be mistaken for product code.

**Non-Goals:**

- Anything about windowing, overlays or Tauri. That is `mascot-escalation`.
- Driving the state machine. The page receives a state; it never selects one.
- A component gallery. One page, purpose-built, deletable without ceremony.

## Decisions

### Vite, because the toolchain is already there

Vitest already pulls in Vite, and `@vitejs/plugin-react` is already a dev dependency.
Adding Vite as a direct dev dependency adds no new transitive weight and no second
bundler.

*Alternative considered* — a static HTML page with the components pre-rendered to a file,
no dev server at all. Cheaper, and it would have solved the "throwaway preview in /tmp"
problem. Rejected because `e2e.config.ts` wants a served address, and a static file cannot
be driven without re-generating it. If e2e is ever dropped, this decision is the one to
revisit.

### Port 3000, chosen by the existing config rather than by us

`e2e.config.ts` already defaults to `localhost:3000` and has the dev-server line
commented out, ready to enable. Matching it means the harness is the thing the runner was
written to expect, rather than a second thing that needs reconfiguring.

### Every state at once, plus a single-state route

Two modes from one page, because they answer different questions:

```
 no state requested   all nine, one baseline  -> is the vocabulary right?
                      does needsYou read as distinct from idle?
 state requested      that state alone, large  -> is this one right?
```

The all-states view is the one that matters most — the vocabulary is a set, and the
question "are these nine states the right nine" is only answerable by seeing them
together. Sharing one canvas size and baseline across them is deliberate: it makes an
apparent scale difference visible rather than hiding it in per-card sizing.

### Small sizes are a first-class part of the page

The artwork carries sub-pixel stroke widths that only hold above roughly 48px. Nothing
enforces that today, and the mascot's real deployment sizes are unknown. Showing a small
and a large rendering side by side is what turns "shouldn't be used below 48px" from a
comment into something you can see.

### `Mascot` is called directly; the page holds no selection logic

The page imports `Mascot` and renders `state={...}`. It never calls `selectState`, never
imports from `src/state-selection/`, and never decides anything.

This matters for a specific reason: `mascot-states` is headless by design, and the moment
the harness derives its own state, there are two places where "which state should be
shown" is answered and only one of them is tested. Pinning it in a requirement rather than
in a code comment means the duplication cannot appear quietly.

### The page lives under `src/dev/`, excluded from the build

Development-only code still has to be somewhere TypeScript can see it, or `typecheck`
stops covering it. `src/dev/` keeps it inside the existing project while making the
boundary explicit. Nothing imports from it, so it cannot reach the product bundle.

*Alternative considered* — a top-level `dev/` directory. Rejected: it sits outside the
existing tsconfig include, so it would need its own configuration and would silently stop
being typechecked.

### No styling framework, no gallery library

Plain CSS in the page. The page is deleted when the real application exists; anything
added to it is maintenance on scaffolding. A gallery framework would be a second
dependency whose only user is a page with one job.

## Risks / Trade-offs

**The harness becomes the app by accident** → It holds no selection logic, imports only
`Mascot`, and is required to leave the mascot's tests passing. The guard is cheap and the
temptation is real, because it is the easiest place to prototype the overlay.

**A fifth state is added and the page is hand-edited** → The page enumerates states from
the vocabulary rather than listing them, and a test asserts a new state appears without
editing the page.

**Vitest's Vite and the harness's Vite drift** → Both resolve to one installed Vite as a
direct dependency. If they ever diverge, the harness is the thing to update.

**Small-size legibility is checked by eye only** → Accepted. A rendering assertion for
stroke legibility would be a rendering test asserting a rasteriser's behaviour, which is
brittle and tests nothing useful.

## Migration Plan

None. Additive, development-only, and deleting `src/dev/`, `index.html`, `vite.config.ts`
and the `dev` script removes it entirely.

## Open Questions

None.

Deferred — driving the state machine from the page, and any windowing — are separate
changes. The first belongs with `mascot-escalation`, where there is a real surface to
drive rather than a scaffolding one.