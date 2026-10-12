/**
 * Where the window goes, and whether it went there.
 *
 * ## Why this is arithmetic and not a request
 *
 * `docs/platform-findings.md` records the finding this file exists to act on:
 * `set_position` returns `Ok` on GNOME Wayland and the window does not move. So
 * the host asks, and then reads back — and the comparison lives here rather than
 * in the window, because a comparison that lived next to the call would be
 * comparing the call's own output to its own input.
 *
 * Nothing here resizes anything. The requested width and height in
 * `tauri.conf.json` are a suggestion the platform is free to decline, and
 * `escalation-surface`'s "sized by its content" requirement is what handles the
 * answer. A host that corrected a window which came back a different size would
 * be how a mascot ends up cropped or letterboxed, so there is no correction to
 * find here.
 *
 * ## The fallback corner
 *
 * A companion that cannot determine where to be places itself somewhere and says
 * so, rather than refusing to start: the user gets a mascot in a known place,
 * not no mascot. The corner is the bottom-left of the primary screen, inset by
 * the same margin used when the work area *is* known, so the two paths look the
 * same and the fallback is not a different-looking product.
 */

import type { Position, WorkArea } from "./host";

/**
 * The gap kept between the window and the edge of the work area.
 *
 * Enough that the mascot is not touching the screen edge, small enough that it
 * never runs off it on a small display — which is why the placement clamps
 * rather than trusting the arithmetic to stay in range.
 */
export const MARGIN = 24;

/** The size the window is placed as, which the platform may decline. */
export const REQUESTED_SIZE = { width: 160, height: 180 } as const;

/**
 * Where the window goes when the platform cannot say where the work area is.
 *
 * The bottom-left corner rather than the origin, because (0, 0) is where an
 * unplaced window lands and a companion sitting in the top-left corner reads as
 * a mistake. A corner the user recognises is a corner they can find.
 */
export const FALLBACK_CORNER: Position = { x: MARGIN, y: MARGIN };

/**
 * The position to place the window at.
 *
 * The bottom-left of the work area, inset by `MARGIN`, and clamped so the whole
 * window is inside it. The clamp is not defensive arithmetic: the requested size
 * is the one the platform is free to decline, so on a display smaller than the
 * window the unclamped answer is off-screen, and a mascot placed off-screen is
 * the failure this function exists to prevent.
 */
export function placementFor(
  workArea: WorkArea | null,
  size: { readonly width: number; readonly height: number } = REQUESTED_SIZE
): Position {
  if (!workArea) return FALLBACK_CORNER;

  const maxX = workArea.x + workArea.width - size.width;
  const maxY = workArea.y + workArea.height - size.height;

  return {
    x: clamp(workArea.x + MARGIN, workArea.x, maxX),
    y: clamp(workArea.y + workArea.height - size.height - MARGIN, workArea.y, maxY),
  };
}

/** `value`, held inside `[low, high]` — and against `low` when they cross. */
function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Whether the window ended up where it was asked to go.
 *
 * `actual === null` is `false`, and that is the case that matters: a host that
 * could not read the position back has not verified anything, and reporting
 * "placed" from a window that would not say where it is is how a mascot ends up
 * in a corner with a log line claiming otherwise.
 *
 * The tolerance is one physical pixel, because a compositor is free to round a
 * logical position and a comparison that failed on rounding would be reported as
 * a failure to move on a platform that moved it correctly.
 */
export function positionTookEffect(requested: Position, actual: Position | null): boolean {
  if (!actual) return false;
  return Math.abs(actual.x - requested.x) <= 1 && Math.abs(actual.y - requested.y) <= 1;
}
