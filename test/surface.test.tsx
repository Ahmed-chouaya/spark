import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ESCALATION_LIFT,
  ESCALATION_PULSE_MS,
  EscalationSurface,
  escalationStyle,
  surfaceVisibility,
} from "../src/escalation/EscalationSurface";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "../src/components/mascot/canvas";
import { selectState } from "../src/state-selection";
import { applyEvent } from "../src/state-selection/events";
import { createSession, type AgentSession } from "../src/state-selection/session";

/**
 * The escalation surface.
 *
 * These check the three rules the surface exists to enforce: it is on screen
 * when something is actionable, its idle behaviour follows what the platform
 * can do, and it is distinguishable from ambient by something other than
 * colour.
 */

const T0 = 1_000;

const session = (state: AgentSession["state"], block: AgentSession["block"] = null): AgentSession => ({
  ...createSession("claude-code", "a", T0),
  state,
  block,
});

const surface = (container: HTMLElement) => container.querySelector("[data-testid='escalation-surface']");
const stage = (container: HTMLElement) => container.querySelector<HTMLElement>("[data-testid='escalation-stage']");
const mascot = (container: HTMLElement) => container.querySelector("svg[data-state]");

describe("the surface presents the state selection produced", () => {
  it("shows the blocked state when selection says blocked", () => {
    const blocked = [session("needsYou", "authorization")];
    const { container } = render(
      <EscalationSurface
        state={selectState(blocked)}
        escalating
        canHoldPersistentSurface={false}
      />
    );

    expect(mascot(container)?.getAttribute("data-state")).toBe("needsYou");
  });

  it("renders whatever state it is handed, unchanged", () => {
    // It draws a state; it does not choose one. Every state reaches the screen
    // through this component exactly as `selectState` produced it.
    for (const state of ["idle", "thinking", "working", "alert", "tired"] as const) {
      const { container, unmount } = render(
        <EscalationSurface state={state} escalating={false} canHoldPersistentSurface />
      );

      expect(mascot(container)?.getAttribute("data-state"), state).toBe(state);
      unmount();
    }
  });

  it("is on screen when a block arrives", () => {
    const { container } = render(
      <EscalationSurface state="needsYou" escalating canHoldPersistentSurface={false} />
    );

    expect(surface(container)).not.toBeNull();
  });

  it("stops escalating when the block ends", () => {
    // Arrival and resolution, as the requirement states them: the same surface,
    // the two transitions.
    const arrived = render(
      <EscalationSurface state="needsYou" escalating canHoldPersistentSurface={false} />
    );
    expect(arrived.container.querySelector("[data-escalating]")).not.toBeNull();

    const resolved = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface={false} />
    );
    expect(resolved.container.querySelector("[data-escalating]")).toBeNull();
  });

  it("escalation ends on the block, not after a delay", () => {
    // Nothing in the module holds an escalation open, so the flag tracks the
    // condition that caused it and stops the moment it is false.
    expect(surfaceVisibility(true, false).escalating).toBe(true);
    expect(surfaceVisibility(false, false).escalating).toBe(false);
  });
});

describe("idle behaviour follows platform capability", () => {
  it("stays visible and ambient where the platform can hold a persistent surface", () => {
    const visibility = surfaceVisibility(false, true);

    expect(visibility.visible).toBe(true);
    expect(visibility.escalating).toBe(false);

    const { container } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );
    expect(surface(container)).not.toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();
  });

  it("is absent where the platform cannot hold one", () => {
    const visibility = surfaceVisibility(false, false);

    expect(visibility.visible).toBe(false);

    const { container } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface={false} />
    );
    expect(surface(container)).toBeNull();
  });

  it("appears on a block on either platform", () => {
    for (const persistent of [true, false]) {
      const visibility = surfaceVisibility(true, persistent);
      expect(visibility.visible, String(persistent)).toBe(true);
      expect(visibility.escalating, String(persistent)).toBe(true);
    }
  });

  it("returns to the platform's idle behaviour when the block resolves", () => {
    // Resolving a block is the one input; both platforms answer it their own way.
    expect(surfaceVisibility(false, true).visible).toBe(true);
    expect(surfaceVisibility(false, false).visible).toBe(false);
  });

  it("renders the same one surface for both platforms, not two components", () => {
    // The behaviour differs; the surface does not. Both are this component.
    const persistent = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );
    const escalateOnly = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface={false} />
    );

    expect(mascot(persistent.container)).not.toBeNull();
    expect(mascot(escalateOnly.container)).toBeNull();
  });
});

describe("an ambient surface never takes focus", () => {
  it("never asks for the keyboard while ambient, on either platform", () => {
    // Not merely "does not manage to": it never requests one. A request is the
    // thing that could pull focus away, on some platform, some day.
    for (const persistent of [true, false]) {
      expect(surfaceVisibility(false, persistent).takesFocus, String(persistent)).toBe(false);
    }
  });

  it("does not render a focus request while ambient", () => {
    const { container } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );

    expect(container.querySelector("[data-takes-focus]")).toBeNull();
  });

  it("produces no error on a platform that cannot keep focus away", () => {
    // Some platforms cannot honour a non-focus request at all. That is not an
    // error: it is a platform limitation, and the surface simply does not take
    // focus. What matters is that saying so does not throw.
    expect(() => surfaceVisibility(false, false)).not.toThrow();
    expect(() =>
      render(<EscalationSurface state="idle" escalating={false} canHoldPersistentSurface={false} />)
    ).not.toThrow();
  });

  it("leaves the document's focus alone while ambient", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const { unmount } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );

    expect(document.activeElement).toBe(input);
    unmount();
    input.remove();
  });

  it("takes focus when escalating only where the platform cannot float", () => {
    // Two different situations, two different rules — which is why this is not
    // one boolean.
    expect(surfaceVisibility(true, false).takesFocus).toBe(true);
    expect(surfaceVisibility(true, true).takesFocus).toBe(false);
  });
});

describe("escalation is distinguishable without colour", () => {
  const ambient = escalationStyle(false);
  const escalating = escalationStyle(true);

  it("differs in scale, not only in hue", () => {
    // The requirement, stated as a check: something other than colour changes.
    expect(escalating.transform).not.toBe(ambient.transform);
    expect(escalating.transform).toContain("scale");
  });

  it("lifts the character while escalating", () => {
    expect(escalating.transform).toContain(`translateY(-${ESCALATION_LIFT}em)`);
    expect(ambient.transform).toBe("none");
  });

  it("moves while escalating and is still while ambient", () => {
    expect(escalating.animation).toContain("infinite");
    expect(escalating.animation).toContain(`${ESCALATION_PULSE_MS}ms`);
    expect(ambient.animation).toBe("none");
  });

  it("stays perceptible when the colour difference is removed", () => {
    // Simulated rather than asserted about: drop the glow — the colour channel —
    // and compare what remains. Motion and scale are still different, so the
    // distinction survives for someone who cannot see the hue at all.
    const withoutColour = (s: typeof ambient) => ({ transform: s.transform, animation: s.animation });

    expect(withoutColour(escalating)).not.toEqual(withoutColour(ambient));
    expect(withoutColour(escalating).transform).not.toBe(withoutColour(ambient).transform);
  });

  it("applies the non-colour difference to the rendered surface", () => {
    const { container: hot, unmount } = render(
      <EscalationSurface state="needsYou" escalating canHoldPersistentSurface={false} />
    );
    const { container: cold, unmount: unmountCold } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );

    // Read from the DOM rather than from the function, so this covers the wiring
    // and not only the value.
    expect(stage(hot)?.style.transform).toContain("scale");
    expect(stage(cold)?.style.transform).toBe("none");

    unmount();
    unmountCold();
  });

  it("marks the escalating surface so the distinction is inspectable", () => {
    const { container } = render(
      <EscalationSurface state="needsYou" escalating canHoldPersistentSurface={false} />
    );

    expect(surface(container)?.hasAttribute("data-escalating")).toBe(true);
  });
});

describe("the surface is sized by its content", () => {
  it("emits no width or height of its own", () => {
    // A requested window size is a suggestion the platform may decline, and
    // does: the same request came back 200x239 on one path and 200x200 on the
    // other. So the surface asks for nothing and takes what it is given.
    const { container } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );

    const root = surface(container)!;
    expect(root.getAttribute("width")).toBeNull();
    expect(root.getAttribute("height")).toBeNull();
  });

  it("keeps the mascot's own canvas ratio at any size it is handed", () => {
    // The dimensions the platform actually supplies are a viewport, not a
    // specification, so the artwork has to hold its proportion inside whatever
    // box arrives.
    for (const width of [16, 82, 160, 320, 1024]) {
      const { container, unmount } = render(
        <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface width={width} />
      );

      const svg = mascot(container)!;
      expect(svg.getAttribute("viewBox"), String(width)).toBe(
        `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`
      );
      expect((svg as SVGElement).style.aspectRatio, String(width)).toBe(
        `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`
      );
      // No height attribute, so no unexpected viewport can letterbox it.
      expect(svg.getAttribute("height"), String(width)).toBeNull();

      unmount();
    }
  });

  it("declares no requested dimensions for the stage either", () => {
    const { container } = render(
      <EscalationSurface state="idle" escalating={false} canHoldPersistentSurface />
    );

    const element = stage(container)!;
    expect(element.getAttribute("width")).toBeNull();
    expect(element.getAttribute("height")).toBeNull();
  });
});