import type { SVGProps } from "react";

/**
 * The nine mascot states, in presentation order.
 *
 * Mapped from the original 12-cell sheet as follows:
 *
 * | state      | sheet cell | sheet label   |
 * | ---------- | ---------- | ------------- |
 * | `idle`     | (1,0)      | READY         |
 * | `thinking` | (0,0)      | THINKING      |
 * | `working`  | (0,1)      | PROCESSING    |
 * | `success`  | (0,3)      | SUCCESS       |
 * | `focused`  | (1,1)      | BUSY          |
 * | `alert`    | (1,3)      | ERROR         |
 * | `listening`| (0,2)      | SEARCHING     |
 * | `tired`    | (2,3)      | DO NOT DISTURB|
 * | `needsYou` | (2,2)      | PAUSED        |
 *
 * The remaining sheet cells (UPDATE, TIMER, NOTIFICATION) are not used.
 */
export const MASCOT_STATES = [
  "idle",
  "thinking",
  "working",
  "success",
  "focused",
  "alert",
  "listening",
  "tired",
  "needsYou",
] as const;

export type MascotState = (typeof MASCOT_STATES)[number];

/**
 * Props for an individual state vector.
 *
 * Each state is a standalone `<svg>` that renders into the shared canonical
 * canvas, so it can be dropped into the DOM on its own. Size it with
 * `width`/`height`, or let CSS drive it.
 *
 * `viewBox` is omitted: with one canonical canvas, a caller-supplied value can
 * only break the rendering contract, and TypeScript should reject it rather
 * than let it silently clip the artwork.
 */
export type MascotVectorProps = Omit<SVGProps<SVGSVGElement>, "viewBox">;

/**
 * Internal props for a state vector, which does accept the canonical canvas.
 *
 * Only the wrapper sets `viewBox`; it is never caller-supplied. This type
 * exists so the wrapper can apply the canvas without widening the public
 * `MascotVectorProps` that callers see.
 */
export type MascotVectorInternalProps = SVGProps<SVGSVGElement>;

export interface MascotProps extends MascotVectorProps {
  /** Which face to render. Defaults to `idle`. */
  state?: MascotState;
}
