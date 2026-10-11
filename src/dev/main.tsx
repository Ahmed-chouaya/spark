/**
 * # Mascot state harness
 *
 * A development-only page for looking at the mascot. It renders the full state
 * vocabulary so the questions the state machine was built around — does
 * `needsYou` read as distinct from `idle` at a glance, is this set the right
 * nine, does the artwork hold up at 32px — can be answered by looking rather
 * than by reading source.
 *
 * ## Starting it
 *
 * ```
 * npm install     # once, in a clean checkout
 * npm run dev
 * ```
 *
 * That is the whole setup. Nothing else is needed beyond installing
 * dependencies.
 *
 * ## The address
 *
 * ```
 * http://localhost:3000
 * ```
 *
 * Pinned in `vite.config.ts`, and the address `e2e.config.ts` already points
 * at. The port is strict: if 3000 is taken the server refuses to start instead
 * of moving to 3001, so a stale server is a loud failure rather than a page
 * served from the wrong place.
 *
 * ## Requesting a single state
 *
 * ```
 * http://localhost:3000/?state=needsYou
 * ```
 *
 * `state` takes any name from `MASCOT_STATES`. Two cases are deliberate rather
 * than incidental:
 *
 * - An unrecognised name falls back to `idle` and the page still renders. A
 *   typo in a URL is not a broken build, and the fallback is reported in the
 *   current-state readout rather than silently swallowed.
 * - Omitting `state` shows all nine on one baseline, which is the view the page
 *   exists for.
 *
 * Choosing a state from the control updates the address to match, so whatever
 * is on screen is also what the URL asks for.
 *
 * ## What this page is not
 *
 * It holds no state-selection logic. `src/state-selection/` answers "which
 * state should be shown", and that answer has one home in this codebase; a
 * second one here would be a second, untested copy of it. This page is told a
 * state and renders it.
 *
 * Development-only: nothing in the product sources imports anything under
 * `src/dev/`, so none of this reaches a shipped bundle.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DevPage } from "./DevPage";
import "./dev.css";

/**
 * The state the address asks for, read once at mount.
 *
 * Passed in rather than read inside `DevPage` so the page is a pure function of
 * a request and can be rendered in a test without a browser address to mutate.
 */
const requested = new URLSearchParams(window.location.search).get("state");

const mount = document.getElementById("root");
if (!mount) throw new Error("index.html is missing its #root mount point");

createRoot(mount).render(
  <StrictMode>
    <DevPage requested={requested} />
  </StrictMode>
);