import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot";
import {
  ALL,
  DEFAULT_SIZE,
  DevPage,
  LARGE,
  SIZE_PRESETS,
  SMALL,
  heightFor,
  isMascotState,
  presetNamed,
  resolveSelection,
} from "../src/dev/DevPage";

/**
 * The harness page.
 *
 * These are behavioural tests: the point of the page is that a person can look
 * at nine mascots in one view and answer a question about them, so what is
 * checked here is that the page enumerates the vocabulary, renders it at
 * shared sizes, honours a request for one state, and degrades rather than
 * breaking when the request is nonsense.
 */

const cards = (container: Element): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("[data-state-card]"),
];

const sizeNames = (container: Element): string[] =>
  [...container.querySelectorAll("[data-size]")].map(
    (node) => node.getAttribute("data-size") ?? ""
  );

/** The rendered state names, in the order the page drew them. */
const renderedStates = (container: Element): string[] =>
  cards(container).map((card) => card.getAttribute("data-state-card") ?? "");

/** Move a control the way a person does, rather than by assigning a value. */
const choose = (testId: string, value: string): HTMLSelectElement => {
  const select = screen.getByTestId(testId) as HTMLSelectElement;
  select.focus();
  fireEvent.change(select, { target: { value } });
  return select;
};

describe("every state is on the page", () => {
  it("renders one element per state, each labelled with its own name", () => {
    const { container } = render(<DevPage />);

    // One card per state, no more and no fewer. A state added to the mascot's
    // vocabulary raises this count on its own; nothing here is a list to edit.
    expect(renderedStates(container)).toEqual([...MASCOT_STATES]);
    expect(cards(container)).toHaveLength(MASCOT_STATES.length);

    for (const state of MASCOT_STATES) {
      const card = container.querySelector(`[data-state-card="${state}"]`);
      expect(card, state).not.toBeNull();
      expect(card?.querySelector("h2")?.textContent, state).toBe(state);
      // And the artwork itself, not just the label around it.
      expect(card?.querySelector("svg[data-state]"), state).not.toBeNull();
    }
  });

  it("reads the vocabulary from the mascot rather than restating it", () => {
    // The page's notion of "every state" and the mascot's own are the same
    // list, so the two cannot drift apart.
    expect(MASCOT_STATES).toContain("needsYou");
    expect(isMascotState("needsYou")).toBe(true);
    expect(isMascotState("shy")).toBe(false);
  });

  it("gives every state the same canvas box, so a size difference is a real one", () => {
    const { container } = render(<DevPage />);

    // The comparison this page exists for is only meaningful if the layout is
    // not what differs between states. Every rendering at a given size must
    // therefore be the same box; anything else would let the layout masquerade
    // as a difference in the artwork.
    for (const preset of SIZE_PRESETS) {
      const boxes = [...container.querySelectorAll(`[data-size="${preset.name}"] svg`)];
      expect(boxes.length, preset.name).toBe(MASCOT_STATES.length);

      // Width is the only thing that varies between states, so it is the only
      // thing compared. Height is deliberately not compared: the mascot states
      // `aspect-ratio` and emits no height, so reading the attribute here would
      // compare `null` against `null` and pass for any width at all.
      const widths = new Set(boxes.map((svg) => svg.getAttribute("width")));
      expect([...widths], `${preset.name}: one box size across all states`).toEqual([
        String(preset.width),
      ]);

      // The height is implied, so assert it is implied rather than absent: every
      // rendering carries the canonical ratio, which is what makes the widths
      // above comparable.
      for (const svg of boxes) {
        expect(svg.getAttribute("height"), preset.name).toBeNull();
        expect((svg as SVGElement).style.aspectRatio, preset.name).toBe("21.3 / 15.2");
      }

      // And the number the page computes for its own assertions still matches.
      expect(heightFor(preset.width)).toBeCloseTo(
        (preset.width * 15.2) / 21.3,
        10,
      );
    }
  });

  it("keeps every rendering on the canonical canvas ratio", () => {
    const { container } = render(<DevPage />);

    for (const svg of container.querySelectorAll("svg")) {
      expect(svg.getAttribute("viewBox")).toBe("0 0 21.3 15.2");

      // The ratio is declared, not computed into a pixel height. Reading the
      // height attribute here would be `Number(null)` — zero — and `0 / width`
      // never equals the canvas ratio, so this used to be a real assertion. Now
      // it would be an assertion against a value that no longer exists, so the
      // ratio is read from where it is now stated.
      const element = svg as SVGElement;
      expect(element.getAttribute("height")).toBeNull();
      expect(element.style.aspectRatio).toBe("21.3 / 15.2");

      // Every rendering shares the one ratio regardless of its width, which is
      // the property that made the widths comparable at all.
      expect(Number(element.getAttribute("width"))).toBeGreaterThan(0);
    }
  });
});

describe("small and large renderings", () => {
  it("renders every state at both a small and a large size", () => {
    const { container } = render(<DevPage />);

    // Every card carries both sizes, so "is this legible small" is asked of
    // each state rather than of whichever one happens to be on top.
    for (const state of MASCOT_STATES) {
      const card = container.querySelector(`[data-state-card="${state}"]`)!;
      expect(sizeNames(card).sort(), state).toEqual(["large", "small"]);
    }
  });

  it("makes the small rendering genuinely small", () => {
    // The point of the small preset is that it sits below the ~48px the
    // artwork's sub-pixel strokes need. A "small" of 96px would show nothing.
    expect(SMALL.width).toBeLessThan(48);
    expect(LARGE.width).toBeGreaterThan(SMALL.width);
    expect(heightFor(SMALL.width)).toBeLessThan(heightFor(LARGE.width));
  });
});

describe("requesting a single state", () => {
  it("renders only the requested state when one is asked for", () => {
    const { container } = render(<DevPage requested="needsYou" />);

    expect(renderedStates(container)).toEqual(["needsYou"]);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(container.querySelector("svg")?.getAttribute("data-state")).toBe("needsYou");
  });

  it("honours every state the vocabulary defines", () => {
    for (const state of MASCOT_STATES) {
      const { container, unmount } = render(<DevPage requested={state} />);
      expect(renderedStates(container), state).toEqual([state]);
      unmount();
    }
  });

  it("shows the whole vocabulary when nothing is requested", () => {
    for (const requested of [null, undefined, ""]) {
      const { container, unmount } = render(<DevPage requested={requested} />);
      expect(renderedStates(container)).toEqual([...MASCOT_STATES]);
      unmount();
    }
  });

  it("renders a default state for a request that names no state", () => {
    // A bad query string is a typo, not a broken build. It must land on a
    // rendered page, and the readout must say what was actually shown rather
    // than leaving the mistake invisible.
    const { container } = render(<DevPage requested="shy" />);

    expect(renderedStates(container)).toEqual(["idle"]);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
    expect(screen.getByTestId("current-state").textContent).toBe("idle");
  });

  it("falls back for every unknown name, not just one", () => {
    for (const requested of ["shy", "IDLE", "needs-you", "state", "9", " "]) {
      const { container, unmount } = render(<DevPage requested={requested} />);
      expect(renderedStates(container), requested).toEqual(["idle"]);
      unmount();
    }
  });

  it("resolves a request without rendering anything at all", () => {
    // The resolution is separated from rendering so the fallback is a fact
    // about a value rather than a thing observed through the DOM.
    expect(resolveSelection(null)).toBe(ALL);
    expect(resolveSelection("")).toBe(ALL);
    expect(resolveSelection(ALL)).toBe(ALL);
    expect(resolveSelection("alert")).toBe("alert");
    expect(resolveSelection("shy")).toBe("idle");
  });
});

describe("the controls", () => {
  it("offers every state in the vocabulary, plus the aggregate view", () => {
    render(<DevPage />);
    const options = [
      ...screen.getByTestId("state-select").querySelectorAll("option"),
    ].map((option) => option.getAttribute("value"));

    // No state is unreachable through the control, and the aggregate view is
    // offered as a first-class choice rather than being "no selection".
    expect(options).toEqual([ALL, ...MASCOT_STATES]);
  });

  it("renders whatever state is selected, and reports it", () => {
    const { container } = render(<DevPage />);
    expect(screen.getByTestId("current-state").textContent).toBe(ALL);
    expect(renderedStates(container)).toHaveLength(MASCOT_STATES.length);

    for (const state of MASCOT_STATES) {
      choose("state-select", state);

      expect(renderedStates(container), state).toEqual([state]);
      // The readout is what a person — or an automated run — reads to know
      // what is on screen, so it has to move with the selection.
      expect(screen.getByTestId("current-state").textContent, state).toBe(state);
    }
  });

  it("returns to the whole vocabulary when the aggregate view is selected", () => {
    const { container } = render(<DevPage requested="tired" />);
    expect(renderedStates(container)).toEqual(["tired"]);

    choose("state-select", ALL);

    expect(renderedStates(container)).toEqual([...MASCOT_STATES]);
    expect(screen.getByTestId("current-state").textContent).toBe(ALL);
  });

  it("defaults to a size worth inspecting when none is requested", () => {
    render(<DevPage />);

    // Large by default: the page exists to be looked at closely. Defaulting to
    // small would make the common case the least legible one.
    expect(DEFAULT_SIZE).toBe(LARGE);
    expect(presetNamed(DEFAULT_SIZE.name)).toBe(LARGE);
    expect((screen.getByTestId("size-select") as HTMLSelectElement).value).toBe("large");
    expect(screen.getByTestId("current-size").textContent).toContain("160px");
  });

  it("offers both sizes, and renders the one that is chosen", () => {
    const { container } = render(<DevPage requested="working" />);
    const select = screen.getByTestId("size-select") as HTMLSelectElement;

    expect([...select.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
      "small",
      "large",
    ]);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("160");

    for (const preset of [SMALL, LARGE]) {
      choose("size-select", preset.name);

      expect(container.querySelector("svg")?.getAttribute("width"), preset.name).toBe(
        String(preset.width)
      );
      expect(screen.getByTestId("current-size").textContent, preset.name).toContain(
        `${preset.width}px`
      );
    }
  });

  it("resolves a size name it does not know to the default", () => {
    expect(presetNamed("enormous")).toBe(DEFAULT_SIZE);
    expect(presetNamed("small")).toBe(SMALL);
  });
});

describe("the request and the control agree", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("keeps the address describing what is on screen", () => {
    // The page is meant to be driven by an automated run, not only by a person.
    // If the control changed the view without changing the address, nothing
    // afterwards could tell which state a given screenshot was of.
    render(<DevPage />);

    choose("state-select", "listening");
    expect(new URLSearchParams(window.location.search).get("state")).toBe("listening");
    expect(window.location.pathname).toBe("/");

    // And back again, so the address does not accumulate a state nobody is
    // looking at any more.
    choose("state-select", ALL);
    expect(new URLSearchParams(window.location.search).get("state")).toBeNull();
  });
});