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

  it("states the canvas aspect ratio rather than a fixed default height", () => {
    const { container } = render(<Mascot state="idle" />);
    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe(String(DEFAULT_WIDTH));
    expect(DEFAULT_WIDTH).toBe(82);
    // No height attribute: a fixed one is only correct at one width, so the
    // ratio is stated and the height follows whatever width is in effect.
    expect(svg.getAttribute("height")).toBeNull();
    expect(svg.style.aspectRatio).toBe(`${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`);
    // DEFAULT_HEIGHT remains a true statement about DEFAULT_WIDTH...
    expect(DEFAULT_HEIGHT).toBeCloseTo((82 * CANVAS_HEIGHT) / CANVAS_WIDTH, 10);
    // ...but the rendered element no longer depends on it, which is the fix.
    expect(svg.getAttribute("height")).not.toBe(String(DEFAULT_HEIGHT));
  });

  it("keeps the ratio whatever width it is given", () => {
    // The bug this pins: a constant default height meant `width={320}` still
    // emitted `height="58.5"`, so the dev harness had to compute and pass its
    // own height on every call.
    for (const width of [16, 32, 82, 160, 320, 1024]) {
      const { container, unmount } = render(<Mascot state="idle" width={width} />);
      const svg = svgOf(container);

      expect(svg.getAttribute("width"), `width ${width}`).toBe(String(width));
      // No width-specific height is emitted, so the browser cannot letterbox.
      expect(svg.getAttribute("height"), `width ${width}`).toBeNull();
      expect(svg.style.aspectRatio, `width ${width}`).toBe(
        `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
      );

      unmount();
    }
  });

  it("lets a caller style override the aspect ratio", () => {
    const { container } = render(
      <Mascot state="idle" style={{ aspectRatio: "1 / 1", opacity: 0.5 }} />,
    );
    const svg = svgOf(container);
    // The caller's style wins rather than being clobbered, and their other
    // declarations survive alongside it.
    expect(svg.style.aspectRatio).toBe("1 / 1");
    expect(svg.style.opacity).toBe("0.5");
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
