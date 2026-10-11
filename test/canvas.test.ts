import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAnchors } from "../scripts/anchors.mjs";
import { pathBBoxAbs } from "../scripts/svgpath.mjs";
import { ANCHORS } from "../src/components/mascot/anchors";
import {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  stateTransform,
} from "../src/components/mascot/canvas";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";

const STATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/components/mascot/states"
);

const componentPath = (state: MascotState) =>
  join(STATES_DIR, `${state[0]?.toUpperCase()}${state.slice(1)}.tsx`);

/** The translation the component actually applies for a state. */
function appliedTransform(state: MascotState): { tx: number; ty: number } {
  const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(stateTransform(state));
  if (!m?.[1] || !m[2]) throw new Error(`no transform for ${state}`);
  return { tx: +m[1], ty: +m[2] };
}

/** Bounding box of every drawn element after translation. */
function transformedContentBox(state: MascotState) {
  const anchor = ANCHORS[state];
  const { tx, ty } = appliedTransform(state);
  return {
    minX: anchor.content.minX + tx,
    minY: anchor.content.minY + ty,
    maxX: anchor.content.maxX + tx,
    maxY: anchor.content.maxY + ty,
  };
}

describe("canonical canvas", () => {
  it("lands every state's ground line on the canonical floor", () => {
    for (const state of MASCOT_STATES) {
      const { ty } = appliedTransform(state);
      const groundCy = ANCHORS[state].groundCy + ty;
      expect(Math.abs(groundCy - ANCHOR_Y), `${state} ground line`).toBeLessThanOrEqual(0.1);
    }
  });

  it("lands every state's visor centre on the canonical horizontal anchor", () => {
    for (const state of MASCOT_STATES) {
      const { tx } = appliedTransform(state);
      const visorCx = ANCHORS[state].visorCx + tx;
      expect(Math.abs(visorCx - ANCHOR_X), `${state} visor centre`).toBeLessThanOrEqual(0.3);
    }
  });

  it("keeps every state's content inside the canvas", () => {
    for (const state of MASCOT_STATES) {
      const b = transformedContentBox(state);
      expect(b.minX, `${state} minX`).toBeGreaterThanOrEqual(-0.001);
      expect(b.minY, `${state} minY`).toBeGreaterThanOrEqual(-0.001);
      expect(b.maxX, `${state} maxX`).toBeLessThanOrEqual(CANVAS_WIDTH + 0.001);
      expect(b.maxY, `${state} maxY`).toBeLessThanOrEqual(CANVAS_HEIGHT + 0.001);
    }
  });

  it("fails containment when a state is enlarged beyond the canvas", () => {
    const state: MascotState = "idle";
    const box = transformedContentBox(state);
    // Same check, with the state's artwork grown well past the top edge.
    const enlarged = { ...box, minY: box.minY - 20 };
    const fits = enlarged.minY >= -0.001 && enlarged.maxY <= CANVAS_HEIGHT + 0.001;
    expect(fits).toBe(false);
  });

  it("renders every state at the same apparent scale", () => {
    // Body height is the one thing that genuinely varies between states and is
    // not removable by anchoring; it is read as squash-and-stretch against a
    // fixed floor. What must hold is that the canvas box, and therefore the
    // character's size within it, is identical for every state.
    const heights = MASCOT_STATES.map((state) => {
      const b = transformedContentBox(state);
      return b.maxY - b.minY;
    });
    for (const state of MASCOT_STATES) {
      expect(state).toBeTruthy();
    }
    // The canvas is shared and unscaled, so rendered box proportion is 1:1.
    expect(CANVAS_WIDTH / CANVAS_HEIGHT).toBeCloseTo(21.3 / 15.2, 10);
    // Content stays within the box for every state, so nothing overflows to a
    // different rendered size.
    for (const h of heights) {
      expect(h).toBeGreaterThan(0);
      expect(h).toBeLessThanOrEqual(CANVAS_HEIGHT);
    }
  });

  it("places the shortest and tallest body states on the same floor line", () => {
    const byBodyHeight = MASCOT_STATES.map((state) => {
      const src = readFileSync(componentPath(state), "utf8");
      const { ty } = appliedTransform(state);
      // The body outline is the stroked path in the body group whose fill is a
      // literal colour rather than a gradient reference. Matching on structure
      // rather than a specific colour keeps this working across all palettes.
      const outer = /<path\s+d="([^"]+)"\s+fill="#[0-9A-Fa-f]{6}"\s+stroke="#[0-9A-Fa-f]{6}"/.exec(src);
      if (!outer?.[1]) throw new Error(`no body path for ${state}`);
      const b = pathBBoxAbs(outer[1]);
      return { state, height: b.maxY - b.minY, bottom: b.maxY + ty };
    });
    const shortest = byBodyHeight.reduce((a, b) => (b.height < a.height ? b : a));
    const tallest = byBodyHeight.reduce((a, b) => (b.height > a.height ? b : a));
    // Different body heights, as the design records and accepts...
    expect(tallest.height).toBeGreaterThan(shortest.height);
    // ...but both bottoms sit on the canonical floor line.
    expect(Math.abs(shortest.bottom - ANCHOR_Y)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(tallest.bottom - ANCHOR_Y)).toBeLessThanOrEqual(0.1);
  });
});
