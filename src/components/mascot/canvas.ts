import type { MascotState } from "./types";
import { ANCHORS } from "./anchors";

/**
 * The canonical canvas every state renders into.
 *
 * This supersedes the "tight `viewBox` per state" rule from the original
 * extraction brief — that rule is what produced the rescale bug, because eight
 * tight crops mean eight box sizes and no sizing rule holds across them. A
 * per-state tight crop must not be reintroduced, in whole or in part.
 *
 * Width is 21.3 rather than the 21 originally recorded, because `needsYou`
 * carries a notification-bell badge that reaches 21.265 once its visor is
 * anchored at 10.5. The original figure assumed that state had no fx; it does,
 * and the canvas grows rather than clipping it.
 */
export const CANVAS_WIDTH = 21.3;
export const CANVAS_HEIGHT = 15.2;

/** The horizontal anchor: the visor centre lands here. */
export const ANCHOR_X = 10.5;

/** The vertical anchor: the floor line lands here. */
export const ANCHOR_Y = 13.3;

/** The one canvas declaration any state may render into. */
export const CANVAS_VIEWBOX = `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`;

/** Default rendered width; the default height follows from the canvas ratio. */
export const DEFAULT_WIDTH = 82;
export const DEFAULT_HEIGHT = (DEFAULT_WIDTH * CANVAS_HEIGHT) / CANVAS_WIDTH;

/**
 * Per-state translation placing the artwork's anchors on the canonical ones.
 *
 * X is anchored on the visor, not the ground bar: the artwork's body-to-floor
 * relationship is inconsistent, and anchoring X on the floor bar would swing
 * the face across ~10% of the canvas width between states. The floor bar then
 * drifts a little by design, which spends the error on the soft glow at the
 * feet rather than on the face.
 */
export function stateTransform(state: MascotState): string {
  const { visorCx, groundCy } = ANCHORS[state];
  const tx = ANCHOR_X - visorCx;
  const ty = ANCHOR_Y - groundCy;
  return `translate(${tx.toFixed(6)} ${ty.toFixed(6)})`;
}
