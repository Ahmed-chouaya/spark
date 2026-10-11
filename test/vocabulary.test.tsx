import { render, screen } from "@testing-library/react";
import { Mascot, MASCOT_VECTORS } from "../src/components/mascot/Mascot";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";

describe("state vocabulary", () => {
  it("resolves all nine states to a component and an accessible label", () => {
    expect(MASCOT_STATES).toHaveLength(9);
    const labels = new Set<string>();
    for (const state of MASCOT_STATES) {
      expect(MASCOT_VECTORS[state]).toBeTypeOf("function");
      const { container, unmount } = render(<Mascot state={state} />);
      const label = container.querySelector("svg")?.getAttribute("aria-label");
      expect(label, state).toBeTruthy();
      labels.add(label as string);
      unmount();
    }
    expect(labels.size).toBe(9);
  });

  it("accepts focused and needsYou, and not shy", () => {
    const accepts = (s: string): s is MascotState =>
      (MASCOT_STATES as readonly string[]).includes(s);
    expect(accepts("focused")).toBe(true);
    expect(accepts("needsYou")).toBe(true);
    expect(accepts("shy")).toBe(false);
  });
});
