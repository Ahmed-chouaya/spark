/**
 * Emit the derived anchors as committed data.
 *
 * Run with `npm run extract:anchors`. The output is imported by the state
 * components, so the numbers they position themselves by are always the ones
 * derived from the artwork rather than values typed by hand.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAllAnchors } from "./anchors.mjs";

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/components/mascot/anchors.ts"
);

const round = (n) => Math.round(n * 1e6) / 1e6;

const anchors = deriveAllAnchors();
const states = Object.keys(anchors).sort();

const entries = states
  .map((state) => {
    const a = anchors[state];
    const c = a.content;
    return [
      `  ${state}: {`,
      `    visorCx: ${round(a.visorCx)},`,
      `    groundCy: ${round(a.groundCy)},`,
      `    content: { minX: ${round(c.minX)}, minY: ${round(c.minY)}, maxX: ${round(c.maxX)}, maxY: ${round(c.maxY)} },`,
      `  },`,
    ].join("\n");
  })
  .join("\n");

const source = `/**
 * Per-state anchors, derived from the artwork by \`scripts/extract-anchors.mjs\`.
 *
 * Generated file: do not edit by hand. Re-run the extraction step instead —
 * \`test/anchors.test.ts\` re-derives from source and fails if this drifts.
 */
import type { MascotState } from "./types";

export interface StateAnchor {
  /** Horizontal centre of the visor, in source coordinates. */
  visorCx: number;
  /** Vertical position of the floor line, in source coordinates. */
  groundCy: number;
  /** Bounding box of all rendered content, in source coordinates. */
  content: { minX: number; minY: number; maxX: number; maxY: number };
}

export const ANCHORS: Record<MascotState, StateAnchor> = {
${entries}
};
`;

writeFileSync(OUT, source);
console.log(`wrote ${OUT} (${states.length} states)`);
