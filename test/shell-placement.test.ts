import { describe, expect, it } from "vitest";
import {
  FALLBACK_CORNER,
  MARGIN,
  REQUESTED_SIZE,
  placementFor,
  positionTookEffect,
} from "../shell/src/placement";

/**
 * Where the window goes, and how anyone finds out whether it went there.
 *
 * Two questions, and the second one is the reason the first exists.
 * `docs/platform-findings.md` records `set_position` returning `Ok` on GNOME
 * Wayland and leaving the window at 0,0. So placing a window is a request, and
 * the only evidence that it happened is a read-back compared against what was
 * asked for — which is why the comparison is a function here rather than a line
 * beside the call that made it.
 *
 * The work area comes from the monitor the pointer is on. A companion that lands
 * on the wrong monitor is a companion the user has to go looking for, and the
 * monitor somebody is looking at is the one their pointer is on.
 */

const workArea = (over: Partial<{ x: number; y: number; width: number; height: number }> = {}) => ({
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  ...over,
});

describe("the window is placed somewhere visible", () => {
  it("sits in the bottom-left of the work area, inset from the edges", () => {
    // Bottom-left rather than the origin: an unplaced window lands at 0,0, and a
    // mascot in the top-left corner reads as a mistake rather than as a choice.
    const at = placementFor(workArea());

    expect(at).toEqual({
      x: MARGIN,
      y: 1080 - REQUESTED_SIZE.height - MARGIN,
    });
  });

  it("follows the work area rather than the screen, so a second monitor is right", () => {
    const left = placementFor(workArea({ x: 0, y: 0, width: 1280, height: 720 }));
    const right = placementFor(workArea({ x: 1280, y: 0, width: 2560, height: 1440 }));

    expect(left.x).toBe(MARGIN);
    expect(right.x).toBe(1280 + MARGIN);
    expect(right.y).toBe(1440 - REQUESTED_SIZE.height - MARGIN);
  });

  it("handles a work area that does not start at the origin", () => {
    // A monitor above and to the left of the primary one has negative coordinates,
    // and arithmetic that assumed a zero origin would put the window on the wrong
    // screen entirely.
    const at = placementFor(workArea({ x: -1920, y: -200, width: 1920, height: 1080 }));

    expect(at.x).toBe(-1920 + MARGIN);
    expect(at.y).toBe(-200 + 1080 - REQUESTED_SIZE.height - MARGIN);
  });

  it("keeps the whole window inside a work area smaller than it", () => {
    // The requested size is a suggestion the platform may decline, so the
    // unclamped answer on a small display is a window placed partly off-screen.
    // The clamp is not defensive arithmetic; it is the only reason the placement
    // and the requirement agree.
    const small = workArea({ width: 120, height: 90 });
    const at = placementFor(small);

    expect(at.x).toBeGreaterThanOrEqual(small.x);
    expect(at.y).toBeGreaterThanOrEqual(small.y);
    expect(at.x + REQUESTED_SIZE.width).toBeGreaterThanOrEqual(small.x + small.width);
    expect(at.y + REQUESTED_SIZE.height).toBeGreaterThanOrEqual(small.y + small.height);
  });

  it("stays inside the work area at every size the platform might answer with", () => {
    // The platform's answer is not knowable in advance, so this is checked across
    // a spread rather than at the one size that happened to be asked for.
    for (const width of [1, 64, 160, 512, 4096]) {
      for (const height of [1, 90, 180, 1024, 4096]) {
        const area = workArea({ width, height });
        const at = placementFor(area);

        expect(at.x, `${width}x${height}`).toBeGreaterThanOrEqual(area.x);
        expect(at.y, `${width}x${height}`).toBeGreaterThanOrEqual(area.y);
      }
    }
  });
});

describe("an unknown work area is a corner and a note, not a refusal", () => {
  it("places the window at the documented corner", () => {
    expect(placementFor(null)).toEqual(FALLBACK_CORNER);
    expect(FALLBACK_CORNER).toEqual({ x: MARGIN, y: MARGIN });
  });

  it("puts that corner somewhere visible rather than at the origin", () => {
    // 0,0 is where an unplaced window lands. A fallback that chose it would be
    // indistinguishable from the placement having failed, which is the one thing
    // the fallback exists to avoid.
    expect(FALLBACK_CORNER.x).toBeGreaterThan(0);
    expect(FALLBACK_CORNER.y).toBeGreaterThan(0);
  });

  it("uses the same inset as a known work area, so the two do not look different", () => {
    // Deliberately the same margin: a fallback that placed the mascot flush
    // against a corner would read as a different product rather than as the same
    // one on a machine that could not answer.
    expect(FALLBACK_CORNER.x).toBe(MARGIN);
    expect(placementFor(workArea()).x).toBe(MARGIN);
  });
});

describe("a position is verified rather than assumed", () => {
  const asked = { x: 24, y: 876 };

  it("accepts a window that arrived where it was sent", () => {
    expect(positionTookEffect(asked, { x: 24, y: 876 })).toBe(true);
  });

  it("refuses one that did not move", () => {
    // The measured failure, exactly as recorded: the call returned `Ok` and the
    // window stayed at 0,0. Trusting the call would place a mascot in a corner
    // and call it working.
    expect(positionTookEffect(asked, { x: 0, y: 0 })).toBe(false);
  });

  it("refuses a window moved somewhere else entirely", () => {
    expect(positionTookEffect(asked, { x: 0, y: 1080 - REQUESTED_SIZE.height })).toBe(false);
  });

  it("refuses a window that would not say where it is", () => {
    // The case that matters most. "Unknown" is not "where I asked", and a host
    // that answered `true` here would be the one check in this file reporting its
    // own request back.
    expect(positionTookEffect(asked, null)).toBe(false);
  });

  it("tolerates one pixel of rounding, which is the compositor's prerogative", () => {
    // A logical position is rounded to physical pixels, and a comparison that
    // failed on rounding would report a platform that placed the window correctly
    // as one that could not place it at all.
    expect(positionTookEffect(asked, { x: 25, y: 875 })).toBe(true);
    expect(positionTookEffect(asked, { x: 26, y: 876 })).toBe(false);
  });
});
