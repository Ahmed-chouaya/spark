import { describe, expect, it } from "vitest";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";
import {
  ESCALATING_STATE,
  canResolve,
  escalates,
  escalatesState,
  isLoud,
} from "../src/state-selection/escalation";
import { applyEvent } from "../src/state-selection/events";
import { createSession, type AgentSession } from "../src/state-selection/session";

const T0 = 1_000;

const held = (
  state: MascotState,
  block: AgentSession["block"] = null
): AgentSession => ({ ...createSession("claude-code", "a", T0), state, block });

describe("exactly one state escalates", () => {
  it("escalates the blocked state and nothing else", () => {
    const escalating = MASCOT_STATES.filter(escalatesState);

    expect(escalating).toEqual([ESCALATING_STATE]);
    expect(escalating).toHaveLength(1);
    expect(ESCALATING_STATE).toBe("needsYou");
  });

  it("escalates a blocked session that the user can resolve", () => {
    const session = held("needsYou", "authorization");

    expect(escalates(session)).toBe(true);
  });
});

describe("unresolvable conditions do not escalate", () => {
  it("does not escalate an agent question, but does escalate an authorisation", () => {
    const question = held("needsYou", "question");
    const authorization = held("needsYou", "authorization");

    expect(escalates(question)).toBe(false);
    expect(escalates(authorization)).toBe(true);
  });

  it("reaches that verdict from the event stream, not just from a hand-built session", () => {
    const asked = applyEvent(held("working"), { type: "agent-question", at: T0 });
    const askedForAccess = applyEvent(held("working"), {
      type: "authorization-requested",
      at: T0,
    });

    expect(asked.state).toBe("needsYou");
    expect(escalates(asked)).toBe(false);

    expect(askedForAccess.state).toBe("needsYou");
    expect(escalates(askedForAccess)).toBe(true);
  });

  it("knows which reasons the companion can actually complete", () => {
    expect(canResolve("authorization")).toBe(true);
    expect(canResolve("question")).toBe(false);
    expect(canResolve(null)).toBe(false);
  });
});

describe("a fault is loud but does not escalate", () => {
  it("stays loud", () => {
    const failed = held("alert");

    expect(failed.state).toBe("alert");
    expect(isLoud(failed.state)).toBe(true);
  });

  it("does not escalate, because the session has already ended", () => {
    expect(escalates(held("alert"))).toBe(false);
    expect(escalatesState("alert")).toBe(false);
  });

  it("makes loudness and escalation two different questions", () => {
    for (const state of MASCOT_STATES) {
      const loud = isLoud(state);
      const escalating = escalatesState(state);
      // Loud without escalating is the fault; escalating is necessarily loud.
      if (escalating) expect(loud, state).toBe(true);
      if (loud && !escalating) expect(state, state).toBe("alert");
    }
  });
});