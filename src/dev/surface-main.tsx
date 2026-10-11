/**
 * Entry for the escalation surface harness.
 *
 * ```
 * npm run dev
 * ```
 *
 * then open `http://localhost:3000/surface.html`. Same server as the state
 * harness — it is a second page, not a second server, so the two can be opened
 * side by side and compared.
 *
 * ## Forcing a platform
 *
 * ```
 * /surface.html                      this machine's own answer
 * /surface.html?platform=persistent  the branch this machine cannot show
 * /surface.html?platform=transient   the other branch, explicitly
 * ```
 *
 * A machine can demonstrate only one branch of a two-branch rule at a time, so
 * the other one has to be reachable somehow or it is never looked at. This
 * override is on the harness: the product always asks the compositor, and the
 * query parameter does not reach `canHoldPersistentSurface`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SurfaceHarness } from "./SurfaceHarness";

const mount = document.getElementById("root");
if (!mount) throw new Error("surface.html is missing its #root mount point");

createRoot(mount).render(
  <StrictMode>
    <SurfaceHarness />
  </StrictMode>
);