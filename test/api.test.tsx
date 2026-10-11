import { render } from "@testing-library/react";
import { Mascot } from "../src/components/mascot/Mascot";
import { CANVAS_HEIGHT, CANVAS_WIDTH, DEFAULT_HEIGHT, DEFAULT_WIDTH } from "../src/components/mascot/canvas";
import { MASCOT_STATES } from "../src/components/mascot/types";

const svgOf = (container: HTMLElement) => container.querySelector("svg")!;

describe("component API", () => {
  it("renders on the canonical canvas and ignores a caller-supplied viewBox at runtime", () => {
    const { container } = render(
      // @ts-expect-error - a caller-supplied viewBox is rejected by the type;
      // at runtime the canonical canvas must still win.
      <Mascot state="idle" viewBox="0 0 999 999" />
    );
    expect(svgOf(container).getAttribute("viewBox")).toBe(`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`);
  });

  it("derives its default height from the canvas aspect ratio", () => {
    const { container } = render(<Mascot state="idle" />);
    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe(String(DEFAULT_WIDTH));
    expect(DEFAULT_WIDTH).toBe(82);
    expect(svg.getAttribute("height")).toBe(String(DEFAULT_HEIGHT));
    // height follows from the ratio rather than being typed in by hand
    expect(DEFAULT_HEIGHT).toBeCloseTo((82 * CANVAS_HEIGHT) / CANVAS_WIDTH, 10);
    const w = Number(svg.getAttribute("width"));
    const h = Number(svg.getAttribute("height"));
    expect(h / w).toBeCloseTo(CANVAS_HEIGHT / CANVAS_WIDTH, 10);
  });

  it("honours explicit sizing props", () => {
    const { container } = render(<Mascot state="idle" width={120} height={96} />);
    expect(svgOf(container).getAttribute("width")).toBe("120");
    expect(svgOf(container).getAttribute("height")).toBe("96");
  });

  it("emits role and a distinct accessible name per state, from the wrapper only", () => {
    const labels = new Map<string, string>();
    for (const state of MASCOT_STATES) {
      const { container, unmount } = render(<Mascot state={state} />);
      const svg = svgOf(container);
      expect(svg.getAttribute("role"), state).toBe("img");
      const label = svg.getAttribute("aria-label");
      expect(label, state).toBeTruthy();
      expect(svg.getAttribute("data-state"), state).toBe(state);
      labels.set(state, label as string);
      unmount();
    }
    expect(new Set(labels.values()).size).toBe(MASCOT_STATES.length);
  });

  it("lets a caller-supplied accessible name override the state-derived default", () => {
    const { container } = render(<Mascot state="tired" aria-label="Agent is resting" />);
    const svg = svgOf(container);
    expect(svg.getAttribute("aria-label")).toBe("Agent is resting");
    expect(svg.getAttribute("aria-label")).not.toBe("Mascot tired");
    // the role is still supplied
    expect(svg.getAttribute("role")).toBe("img");
  });

  it("looks up every state without a fallback", () => {
    // Every state in the vocabulary resolves to a component; the lookup is
    // total, so there is no `?? Idle` path to exercise.
    for (const state of MASCOT_STATES) {
      const { container, unmount } = render(<Mascot state={state} />);
      expect(svgOf(container).getAttribute("data-state")).toBe(state);
      unmount();
    }
  });
});
