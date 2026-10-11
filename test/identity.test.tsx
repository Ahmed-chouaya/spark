import { render } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { MASCOT_VECTORS } from "../src/components/mascot/Mascot";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";

const vectorFor = (state: MascotState) => {
  const Vector = MASCOT_VECTORS[state];
  if (!Vector) throw new Error(`no component for ${state}`);
  return Vector;
};

/** The distinct colours a state is drawn with, read from its own markup. */
function colorsIn(svg: Element): string[] {
  const stops = [...svg.querySelectorAll("linearGradient stop")].map(
    (s) => s.getAttribute("stop-color") ?? ""
  );
  const fills = [...svg.querySelectorAll("[fill]")]
    .map((e) => e.getAttribute("fill") ?? "")
    .filter((f) => f.startsWith("#"));
  return [...new Set([...stops, ...fills])].sort();
}

function renderAll(keys: string[]): HTMLElement {
  const nodes: ReactElement[] = keys.map((k) => {
    const [state, tag] = k.split("@");
    return createElement(vectorFor(state as MascotState), {
      key: k,
      ...({ "data-testid": tag ?? state } as Record<string, string>),
    });
  });
  return render(<>{nodes}</>).container;
}

describe("per-instance identity", () => {
  it("renders all nine states in one document without inheriting colours", () => {
    // Each state rendered alone first, to learn the colours it is meant to use.
    const expected = new Map<MascotState, string[]>();
    for (const state of MASCOT_STATES) {
      const Vector = vectorFor(state);
      const { container, unmount } = render(<Vector />);
      const svg = container.querySelector("svg");
      expect(svg, state).not.toBeNull();
      expected.set(state, colorsIn(svg!));
      unmount();
    }

    // Then all nine together, and read each back out of the shared document.
    const container = renderAll(MASCOT_STATES.map((s) => `${s}@${s}`));
    for (const state of MASCOT_STATES) {
      const svg = container.querySelector(`[data-testid="${state}"]`);
      expect(svg, state).not.toBeNull();
      expect(colorsIn(svg!), `${state} colours`).toEqual(expected.get(state));
    }
  });

  it("gives every element a unique id across two copies of all nine states", () => {
    const keys = [
      ...MASCOT_STATES.map((s) => `${s}@${s}-a`),
      ...MASCOT_STATES.map((s) => `${s}@${s}-b`),
    ];
    const container = renderAll(keys);
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, "every id in the document is unique").toBe(ids.length);
  });

  it("resolves every paint reference to a definition in the same instance", () => {
    const container = renderAll(MASCOT_STATES.map((s) => `${s}@${s}`));
    for (const state of MASCOT_STATES) {
      const svg = container.querySelector(`[data-testid="${state}"]`)!;
      for (const el of svg.querySelectorAll("[fill]")) {
        const fill = el.getAttribute("fill") ?? "";
        const m = /^url\(#(.+)\)$/.exec(fill);
        if (!m?.[1]) continue;
        const target = svg.querySelector(`[id="${m[1]}"]`);
        expect(target, `${state} reference ${fill}`).not.toBeNull();
      }
    }
  });

  it("mutating one instance's parts leaves the other visually unchanged", () => {
    const container = renderAll(["idle@first", "idle@second"]);
    const first = container.querySelector('[data-testid="first"]')!;
    const second = container.querySelector('[data-testid="second"]')!;

    const before = second.outerHTML;
    const firstBody = first.querySelector('[data-part="body"]')!;
    firstBody.setAttribute("opacity", "0");
    firstBody.setAttribute("transform", "scale(0.1)");

    expect(second.outerHTML).toBe(before);
    expect(second.querySelector('[data-part="body"]')!.getAttribute("opacity")).toBeNull();
  });
});
