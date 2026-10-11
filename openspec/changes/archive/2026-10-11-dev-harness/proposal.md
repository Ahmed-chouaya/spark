# Proposal

## Why

The mascot library has no way to be seen. `mascot-rig` and `mascot-states` are both
verified — 130 tests — and neither produces anything a person can look at. The visual
half of this work is currently unexaminable: nobody can answer "does `needsYou` read as
distinct from `idle` at a glance", which is the one question the whole state machine was
designed around.

Two symptoms of the same gap. `e2e.config.ts` already points at
`http://localhost:3000` with its dev-server line commented out, so the e2e harness is
configured against an application that does not exist. And the one preview page that was
used to review the mascot was a throwaway in `/tmp` that nothing regenerates.

## What Changes

- Add a minimal development harness: a Vite dev server serving a single page that renders
  every mascot state, with a clickable state switcher.
- Serve on port 3000 so it matches the address `e2e.config.ts` already expects, and
  register a `dev` script so the runner's commented-out dev-server line can be enabled.
- Make the harness regenerable and durable rather than a scratch artifact: the preview
  becomes a route in the project, not a file someone re-derives when needed.
- **No product code changes.** This is a development tool. It reads the mascot library and
  renders it; it does not alter the mascot, the state machine, or their contracts.
- Keep the harness deliberately thin. It is scaffolding for a companion that does not
  exist yet, and every feature added to it is maintenance on a throwaway.

### Explicitly out of scope

- No Tauri shell, no window, no overlay. That belongs to `mascot-escalation`.
- No wiring of the state machine into the page. The harness renders `Mascot` directly;
  `mascot-states` stays headless and stays tested where it is.
- No styling beyond legibility, no component gallery framework, no design system.
- No new dependency unless the existing toolchain cannot serve the page.

## Capabilities

### New Capabilities

- `dev-harness`: a development-only server and page that renders the mascot's full state
  vocabulary for visual inspection, addressable so an automated run can drive it.

### Modified Capabilities

None. `mascot-rig` owns the rendering contract and is untouched; `mascot-states` owns
state selection and remains headless.

## Impact

- New `index.html`, `vite.config.ts` and a small entry module under `src/dev/`.
- `package.json` gains a `dev` script and a Vite dev dependency.
- `tsconfig.json` includes the dev entry so `typecheck` still covers it.
- No change to `src/components/mascot/` or `src/state-selection/`.
- Development-only. Nothing here ships in the application bundle.