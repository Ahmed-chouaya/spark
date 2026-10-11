import { render } from "@testing-library/react";
import { NeedsYou } from "../src/components/mascot/states/NeedsYou";

describe("NeedsYou", () => {
  it("renders a visible character with the four-part structure", () => {
    const { container } = render(<NeedsYou />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.querySelectorAll("g").length).toBe(5);
    for (const part of ["glow", "body", "eyes", "fx"]) {
      expect(svg!.querySelector(`[data-part="${part}"]`), part).not.toBeNull();
    }
    expect(svg!.querySelectorAll("path,ellipse,circle").length).toBeGreaterThan(0);
  });

  it("uses per-instance paint ids rather than literal ones", () => {
    const { container } = render(<NeedsYou />);
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9]+Paint\d+$/);
      expect(container.innerHTML).toContain(`url(#${id})`);
    }
    expect(ids.some((id) => id.includes("needsYou"))).toBe(false);
  });

  it("keeps its parts independently reachable by scoped query", () => {
    const { container } = render(<NeedsYou />);
    const svg = container.querySelector("svg")!;
    const body = svg.querySelector('[data-part="body"]');
    const eyes = svg.querySelector('[data-part="eyes"]');
    const fx = svg.querySelector('[data-part="fx"]');
    expect(body).not.toBeNull();
    expect(eyes).not.toBeNull();
    expect(fx).not.toBeNull();
    expect(body).not.toBe(eyes);
    expect(eyes).not.toBe(fx);
    expect(body!.children.length).toBeGreaterThan(0);
    expect(eyes!.children.length).toBeGreaterThan(0);
    expect(fx!.children.length).toBeGreaterThan(0);
  });
});
