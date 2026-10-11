# Tasks

## 1. Project scaffold

The repository currently has no package manifest, TypeScript configuration or test
runner, so every verification below is otherwise unrunnable.

- [x] 1.1 Add a package manifest with a `typecheck` script and Vitest wired as the test runner, and verify both scripts are present and executable
- [x] 1.2 Add a TypeScript configuration covering `src/` in strict mode with JSX enabled, and verify `typecheck` reports no errors against the existing mascot sources
- [x] 1.3 Verify the test runner discovers and executes a test, and that its output distinguishes pass from fail
- [x] 1.4 Record the baseline by running `typecheck` and the test suite before any mascot change, and verify the baseline is green so later failures are attributable to this change

## 2. State vocabulary

- [x] 2.1 Rename `Shy.tsx` to `Focused.tsx` — component, exported component symbol and exported viewBox constant — and verify the project typechecks with no `Shy` symbol remaining
- [x] 2.2 Replace `shy` with `focused` in the `MASCOT_STATES` union and verify the exported type no longer accepts `shy` and does accept `focused`
- [x] 2.3 Extract the sheet's `NOTIFICATION` cell into a `NeedsYou.tsx` state component matching the existing four-part structure (glow, body, eyes, fx), namespaced paint ids, and verify it renders
- [x] 2.4 Add `needsYou` to `MASCOT_VECTORS` and `MASCOT_STATES` and verify all nine states resolve to a component and to an accessible label
- [x] 2.5 Update `index.ts` to export the nine components and their viewBox constants under the new names, and verify no stale `Shy` export remains

## 3. Anchor derivation

- [x] 3.1 Write a build-time extraction step that reads each state component's artwork and derives that state's visor centre and ground-line position, and verify it produces an entry for all nine states
- [x] 3.2 Emit the derived anchors as committed data consumed by the state components, and verify every state resolves its anchor without hardcoded values
- [x] 3.3 Add a test that re-derives anchors from the source artwork and asserts equality with the committed data, and verify that introducing a deliberate drift in one state fails the test

## 4. Canonical canvas

- [x] 4.1 Move all nine states onto the single shared 21 x 15.2 canvas, positioned by the derived per-axis translation (visor centre x to 10.5, ground line y to 13.3), and verify no state component declares its own canvas
- [x] 4.2 Remove the per-state tight viewBox constants and any remaining tight crops, and verify none survive anywhere in `src/components/mascot/`
- [x] 4.3 Record in the component documentation that the canonical canvas supersedes the original tight-viewBox-per-state brief, and verify the note is present and states the override explicitly
- [x] 4.4 Add a test asserting every state's ground line lands at 13.3 within 0.1 units, and verify it passes for all nine
- [x] 4.5 Add a test asserting every state's visor centre lands at 10.5 within 0.3 units, and verify it passes for all nine
- [x] 4.6 Add a test asserting every state's transformed content bounding box fits inside the canvas, and verify a deliberately enlarged state fails it
- [x] 4.7 Add a test asserting scale invariance: the shortest-body state and the tallest-body state occupy the same proportion of the rendered box, and verify it passes

## 5. Per-instance identity

- [x] 5.1 Move paint definition ids to per-instance values derived from React's `useId()`, stripping non-alphanumeric characters, and verify all nine states still render their correct colours
- [x] 5.2 Add a test rendering all nine states in one document and asserting each resolves its own colours with none inheriting another's
- [x] 5.3 Convert semantic groups to `data-part` attributes addressed by a scoped query against the component's own root, removing all id-based group addressing, and verify body, eyes and fx are each independently reachable
- [x] 5.4 Add a test rendering two instances of the same state and asserting that mutating one's parts leaves the other visually unchanged

## 6. Component API

- [x] 6.1 Omit the canvas declaration from the accepted props type and verify a caller supplying one is a type error
- [x] 6.2 Apply a default width of 82 with the default height derived from the canvas aspect ratio rather than hardcoded, and verify an unsized render matches that ratio
- [x] 6.3 Move role and the state-derived accessible name into the wrapper only, removing the per-state duplicates, and verify each of the nine states still yields a distinct accessible name
- [x] 6.4 Remove the unreachable fallback in the state lookup and verify the lookup still typechecks as total
- [x] 6.5 Add a test asserting a caller-supplied accessible name overrides the state-derived default

## 7. Integration check

- [x] 7.1 Render all nine states together and verify in one pass that no element id is duplicated in the document, each state's colours are correct, and every anchor assertion from section 4 holds
- [x] 7.2 Verify no `shy` identifier survives anywhere under `src/` and that `focused` and `needsYou` are referenced consistently across the component, its types and its exports