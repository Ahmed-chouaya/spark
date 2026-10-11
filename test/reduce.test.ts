import { describe, expect, it } from "vitest";
import { selectState } from "../src/state-selection/reduce";
import { createSession, type AgentSession } from "../src/state-selection/session";

const session = (
  sessionId: string,
  overrides: Partial<AgentSession> = {}
): AgentSession => ({ ...createSession("claude-code", sessionId, 0), ...overrides });

describe("the reduction renders exactly one state", () => {
  it("rests when no session is live", () => {
    expect(selectState([])).toBe("idle");
  });

  it("renders a single working session as working", () => {
    expect(selectState([session("a", { state: "working", lastActiveAt: 5 })])).toBe(
      "working"
    );
  });

  it("lets a blocked session override a working primary", () => {
    const sessions = [
      session("primary", { state: "working", lastActiveAt: 50 }),
      session("blocked", { state: "needsYou", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("needsYou");
  });

  it("renders the blocked state when every session is blocked", () => {
    const sessions = [
      session("a", { state: "needsYou", lastActiveAt: 30 }),
      session("b", { state: "needsYou", lastActiveAt: 20 }),
      session("c", { state: "needsYou", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("needsYou");
  });

  it("renders the fault state when the primary failed", () => {
    const sessions = [
      session("primary", { state: "alert", lastActiveAt: 50 }),
      session("background", { state: "working", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("alert");
  });

  it("reduces three live sessions to one state, with no per-session output", () => {
    const sessions = [
      session("a", { state: "focused", lastActiveAt: 30 }),
      session("b", { state: "working", lastActiveAt: 20 }),
      session("c", { state: "listening", lastActiveAt: 10 }),
    ];

    const rendered = selectState(sessions);
    expect(rendered).toBe("focused");
    expect(sessions).toHaveLength(3);
  });
});

describe("only the primary drives ambient state", () => {
  it("ignores a background session that is busy", () => {
    const sessions = [
      session("primary", { state: "idle", lastActiveAt: 50 }),
      session("background", { state: "working", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("idle");
  });

  it("does not surface a background session's failure", () => {
    // The accepted cost, pinned as an explicit assertion so it cannot be
    // "fixed" by accident: a background failure is finished news and has no
    // decision attached to it.
    const sessions = [
      session("primary", { state: "idle", lastActiveAt: 50 }),
      session("background", { state: "alert", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("idle");
  });

  it("still surfaces a background session that is blocked", () => {
    const sessions = [
      session("primary", { state: "idle", lastActiveAt: 50 }),
      session("background", { state: "needsYou", lastActiveAt: 10 }),
    ];

    expect(selectState(sessions)).toBe("needsYou");
  });
});

describe("answering a blocked session does not move the primary", () => {
  it("returns to the session that is still primary", () => {
    // The user is driving `driving`, steps over to answer `waiting`, and the
    // answer finishes that session. It does not make it the session being
    // driven, and the companion goes back where it was.
    let sessions: AgentSession[] = [
      session("driving", { state: "idle", lastActiveAt: 100 }),
      session("waiting", { state: "needsYou", lastActiveAt: 50, block: "authorization" }),
    ];

    expect(selectState(sessions)).toBe("needsYou");

    const answered = sessions.map((s) =>
      s.sessionId === "waiting"
        ? { ...s, state: "thinking" as const, block: null, lastEventAt: 120 }
        : s
    );

    expect(selectState(answered)).toBe("idle");
  });
});