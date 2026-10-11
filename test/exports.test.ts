import * as mascot from "../src/components/mascot/index";
import { MASCOT_STATES } from "../src/components/mascot/types";

const VIEWBOX_CONSTANTS: Record<string, string> = {};

describe("public exports", () => {
  it("exports a component for every state", () => {
    const exported = mascot as unknown as Record<string, unknown>;
    for (const state of MASCOT_STATES) {
      const component = (state[0] as string).toUpperCase() + state.slice(1);
      expect(exported[component], component).toBeTypeOf("function");
      if (VIEWBOX_CONSTANTS[state]) {
        const constant = VIEWBOX_CONSTANTS[state] as string;
        expect(exported[constant], state).toBeTypeOf("string");
      }
    }
  });

  it("exports the canonical canvas constants", () => {
    const exported = mascot as unknown as Record<string, unknown>;
    expect(exported.CANVAS_VIEWBOX).toBe("0 0 21.3 15.2");
    expect(exported.ANCHOR_X).toBe(10.5);
    expect(exported.ANCHOR_Y).toBe(13.3);
    expect(exported.stateTransform).toBeTypeOf("function");
  });

  it("exports no per-state viewBox constant", () => {
    const exported = mascot as unknown as Record<string, unknown>;
    // CANVAS_VIEWBOX is the single shared declaration and is expected; what
    // must not exist is a per-state one.
    const allowed = new Set(["CANVAS_VIEWBOX"]);
    for (const key of Object.keys(exported)) {
      if (!key.endsWith("_VIEWBOX")) continue;
      expect(allowed.has(key), key).toBe(true);
    }
  });

  it("does not export the retired Shy symbol", () => {
    const exported = mascot as unknown as Record<string, unknown>;
    expect(exported.Shy).toBeUndefined();
    expect(exported.SHY_VIEWBOX).toBeUndefined();
  });
});
