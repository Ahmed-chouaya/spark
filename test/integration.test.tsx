import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "@testing-library/react";
import { Mascot, MASCOT_VECTORS } from "../src/components/mascot/Mascot";
import { ANCHORS } from "../src/components/mascot/anchors";
import {
  ANCHOR_X,
  ANCHOR_Y,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  stateTransform,
} from "../src/components/mascot/canvas";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

/** Every source file under src/, recursively. */
function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(p) : [p];
  });
}

describe("integration", () => {
  it("renders all nine states together with no duplicate id, correct colours, and every anchor holding", () => {
    const container = render(
      <>
        {MASCOT_STATES.map((state) => (
          <Mascot key={state} state={state} />
        ))}
      </>
    ).container;

    const svgs = [...container.querySelectorAll("svg")];
    expect(svgs).toHaveLength(MASCOT_STATES.length);

    // 1. no duplicated id anywhere in the document
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, "no duplicated element id").toBe(ids.length);

    // 2. each state carries its own colours, and every paint ref resolves
    for (const [index, state] of MASCOT_STATES.entries()) {
      const svg = svgs[index] as SVGSVGElement;
      expect(svg.getAttribute("data-state"), state).toBe(state);

      const stops = [...svg.querySelectorAll("linearGradient stop")].map((s) =>
        s.getAttribute("stop-color")
      );
      expect(stops.length, `${state} has paint stops`).toBeGreaterThan(0);
      expect(new Set(stops).size, `${state} has real colours`).toBeGreaterThan(1);

      for (const el of svg.querySelectorAll("[fill]")) {
        const m = /^url\(#(.+)\)$/.exec(el.getAttribute("fill") ?? "");
        if (!m?.[1]) continue;
        expect(svg.querySelector(`[id="${m[1]}"]`), `${state} ${m[1]}`).not.toBeNull();
      }
    }

    // 3. every anchor assertion from section 4 still holds
    for (const state of MASCOT_STATES) {
      const t = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(stateTransform(state));
      if (!t?.[1] || !t[2]) throw new Error(`no transform for ${state}`);
      const tx = +t[1];
      const ty = +t[2];
      const a = ANCHORS[state];

      expect(Math.abs(a.groundCy + ty - ANCHOR_Y), `${state} floor`).toBeLessThanOrEqual(0.1);
      expect(Math.abs(a.visorCx + tx - ANCHOR_X), `${state} visor`).toBeLessThanOrEqual(0.3);

      const box = {
        minX: a.content.minX + tx,
        minY: a.content.minY + ty,
        maxX: a.content.maxX + tx,
        maxY: a.content.maxY + ty,
      };
      expect(box.minX, `${state} minX`).toBeGreaterThanOrEqual(-0.001);
      expect(box.minY, `${state} minY`).toBeGreaterThanOrEqual(-0.001);
      expect(box.maxX, `${state} maxX`).toBeLessThanOrEqual(CANVAS_WIDTH + 0.001);
      expect(box.maxY, `${state} maxY`).toBeLessThanOrEqual(CANVAS_HEIGHT + 0.001);
    }
  });

  it("retains no shy identifier anywhere under src/", () => {
    const offenders = sourceFiles().filter((f) => /shy/i.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.replace(SRC, "src"))).toEqual([]);
  });

  it("references focused and needsYou consistently across component, types and exports", async () => {
    const files = sourceFiles();
    const read = (f: string) => readFileSync(f, "utf8");

    // the vocabulary names them
    const types = read(join(SRC, "components/mascot/types.ts"));
    expect(types).toContain('"focused"');
    expect(types).toContain('"needsYou"');
    expect(MASCOT_STATES).toContain("focused");
    expect(MASCOT_STATES).toContain("needsYou");

    // the components exist under those names
    const statesDir = join(SRC, "components/mascot/states");
    expect(readdirSync(statesDir)).toEqual(
      expect.arrayContaining(["Focused.tsx", "NeedsYou.tsx"])
    );

    // the wrapper maps them
    const mascot = read(join(SRC, "components/mascot/Mascot.tsx"));
    expect(mascot).toContain("focused: Focused");
    expect(mascot).toContain("needsYou: NeedsYou");
    for (const state of ["focused", "needsYou"] as MascotState[]) {
      expect(MASCOT_VECTORS[state], state).toBeTypeOf("function");
    }

    // the barrel exports them
    const index = read(join(SRC, "components/mascot/index.ts"));
    expect(index).toContain('from "./states/Focused"');
    expect(index).toContain('from "./states/NeedsYou"');
  });
});
