import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAnchors, deriveAllAnchors } from "../scripts/anchors.mjs";
import { ANCHORS } from "../src/components/mascot/anchors";
import { MASCOT_STATES } from "../src/components/mascot/types";

const STATES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/components/mascot/states"
);

const TOLERANCE = 1e-6;

/** The emitter commits values rounded to 6 decimals; compare at that scale. */
const near = (a: number, b: number) => Math.abs(a - b) < TOLERANCE;

describe("committed anchors match the source artwork", () => {
  it("derives an entry for all nine states", () => {
    const derived = deriveAllAnchors(STATES_DIR);
    expect(Object.keys(derived).sort()).toEqual([...MASCOT_STATES].sort());
    for (const state of MASCOT_STATES) {
      expect(ANCHORS[state], state).toBeDefined();
      expect(derived[state], state).toBeDefined();
    }
  });

  it("equals the committed data for every state", () => {
    const derived = deriveAllAnchors(STATES_DIR);
    for (const state of MASCOT_STATES) {
      const a = derived[state];
      const b = ANCHORS[state];
      if (!a || !b) throw new Error(`missing anchors for ${state}`);
      expect(near(a.visorCx, b.visorCx), `${state} visorCx`).toBe(true);
      expect(near(a.groundCy, b.groundCy), `${state} groundCy`).toBe(true);
      expect(near(a.content.minX, b.content.minX), `${state} content.minX`).toBe(true);
      expect(near(a.content.minY, b.content.minY), `${state} content.minY`).toBe(true);
      expect(near(a.content.maxX, b.content.maxX), `${state} content.maxX`).toBe(true);
      expect(near(a.content.maxY, b.content.maxY), `${state} content.maxY`).toBe(true);
    }
  });

  it("fails when the artwork drifts from the committed data", () => {
    // Deliberate drift: shift one state's ground line in its source, then
    // confirm the derivation no longer agrees with the committed anchors.
    // Done against the source text in memory rather than by writing the file,
    // so the probe cannot race other test files reading the same artwork.
    const original = readFileSync(join(STATES_DIR, "Idle.tsx"), "utf8");
    const drifted = original.replace(
      /(data-part="glow"[\s\S]*?cy=")([\d.]+)(")/,
      (_m: string, a: string, cy: string, c: string) => `${a}${(+cy + 0.25).toFixed(4)}${c}`
    );
    expect(drifted, "drift was applied").not.toBe(original);

    const derived = deriveAnchors(drifted);
    const drift = derived.groundCy - ANCHORS.idle.groundCy;
    expect(Math.abs(drift)).toBeGreaterThan(TOLERANCE);

    // Undrifted, the same source still agrees.
    const clean = deriveAnchors(original);
    expect(near(clean.groundCy, ANCHORS.idle.groundCy)).toBe(true);
    expect(near(clean.visorCx, ANCHORS.idle.visorCx)).toBe(true);
  });
});
