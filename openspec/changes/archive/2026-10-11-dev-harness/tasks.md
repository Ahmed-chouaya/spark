# Tasks

## 1. Dev server

- [x] 1.1 Add Vite as a direct dev dependency and a `dev` script, and verify `npm run dev` starts a server without an unmet-dependency error
- [x] 1.2 Add a Vite config with the React plugin, root at the project root, and the server pinned to port 3000 with strict port so a conflict fails loudly rather than silently moving, and verify the reported URL is `http://localhost:3000`
- [x] 1.3 Add `index.html` at the project root loading the dev entry module, and verify requesting the root path returns the page
- [x] 1.4 Add `src/dev/` to the TypeScript include so `npm run typecheck` still covers the dev entry, and verify typecheck passes

## 2. State rendering

- [x] 2.1 Render every state
- [x] 2.2 Give the page a shared canvas size and baseline
- [x] 2.3 Render each state at both a small and a large size
- [x] 2.4 Support requesting a single state through the page
- [x] 2.5 Handle an unrecognised requested state

## 3. Controls and documentation

- [x] 3.1 Add a selection control exposing every state in the vocabulary, and verify each state can be selected
- [x] 3.2 Make the current selection observable on the page, and verify it reports the state being shown
- [x] 3.3 Add a size control with a sensible default appropriate for inspection, and verify the default applies when no size is requested
- [x] 3.4 Document in the entry module how to start the page, what address it serves on, and how to request a single state

## 4. Isolation guards

- [x] 4.1 Add a test asserting the dev entry imports the mascot component and nothing from `src/state-selection/`
- [x] 4.2 Add a test asserting the dev entry performs no state selection
- [x] 4.3 Add a test asserting a state added to the vocabulary appears on the page without the page being edited
- [x] 4.4 Add a test asserting nothing in the product sources imports from `src/dev/`

## 5. Integration check

- [x] 5.1 Start the server, open the page, and verify in one pass that all nine states render at one size on one baseline, that a single state can be requested and rendered alone, and that an unknown state degrades to a render
- [x] 5.2 Run the full suite and verify the mascot and state-selection tests pass exactly as before, with no modification to either module
- [x] 5.3 Enable the dev-server command in `e2e.config.ts` and verify the configured address matches where the harness actually serves