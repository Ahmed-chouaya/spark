import { describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot/types";
import {
  REST_AFTER_MS,
  TRANSIENT_WINDOW_MS,
  applyEvent,
  stateForEvent,
  type SessionEvent,
} from "../src/state-selection/events";
import { createSession, type AgentSession } from "../src/state-selection/session";

const T0 = 1_000;

const fresh = (): AgentSession => createSession("claude-code", "a", T0);

/** Fold a list of events into a session, in order. */
const run = (events: SessionEvent[], from: AgentSession = fresh()): AgentSession =>
  events.reduce(applyEvent, from);

describe("agent events map to states", () => {
  it("maps session start to the idle state", () => {
    const started = run([{ type: "session-started", at: T0 }]);
    expect(started.state).toBe("idle");
  });

  it("maps a prompt with no tool activity yet to the transient thinking state", () => {
    const thinking = run([{ type: "prompt-submitted", at: T0 }]);
    expect(thinking.state).toBe("thinking");
  });

  it("maps tool activity to a sustained state chosen by rough effort", () => {
    const thinking = run([{ type: "prompt-submitted", at: T0 }]);
    const buckets = [
      { signals: { elapsedMs: 30, payloadBytes: 64 }, state: "listening" },
      { signals: { elapsedMs: 2_000, payloadBytes: 4_000 }, state: "working" },
      { signals: { elapsedMs: 30_000, payloadBytes: 4_000 }, state: "focused" },
    ] as const;

    for (const { signals, state } of buckets) {
      const working = applyEvent(thinking, {
        type: "tool-activity",
        at: T0 + 100,
        signals,
      });
      expect(working.state, JSON.stringify(signals)).toBe(state);
      expect(MASCOT_STATES).toContain(working.state);
    }
  });

  it("maps successful completion to the transient success state", () => {
    expect(stateForEvent({ type: "completed", at: T0 })).toBe("success");
    expect(run([{ type: "completed", at: T0 }]).state).toBe("success");
  });

  it("maps failure to the fault state", () => {
    const failed = run([{ type: "failed", at: T0 }]);
    expect(failed.state).toBe("alert");
  });

  it("holds a fault against the activity that arrives after it", () => {
    // A failure is the loud thing that happened; a late tool response is not
    // allowed to talk the user out of it.
    const failed = run([{ type: "failed", at: T0 }]);
    const after = applyEvent(failed, {
      type: "tool-activity",
      at: T0 + 50,
      signals: { elapsedMs: 30, payloadBytes: 64 },
    });

    expect(after.state).toBe("alert");
  });

  it("lets a block displace a fault, because block outranks fault", () => {
    const failed = run([{ type: "failed", at: T0 }]);
    const blocked = applyEvent(failed, { type: "authorization-requested", at: T0 + 10 });
    expect(blocked.state).toBe("needsYou");
  });
});

describe("blocking and resting", () => {
  it("maps an authorisation request to the blocked state", () => {
    const blocked = run([{ type: "authorization-requested", at: T0 }]);
    expect(blocked.state).toBe("needsYou");
    expect(blocked.block).toBe("authorization");
  });

  it("maps prolonged inactivity to the resting state", () => {
    const idle = fresh();
    const rested = applyEvent(idle, { type: "time-passed", at: T0 + REST_AFTER_MS });

    expect(rested.state).toBe("tired");
  });

  it("holds rather than rests while nothing happens after a block", () => {
    // A resting companion over an unanswered authorisation would be the system
    // quietly saying it is not waiting after all.
    const blocked = run([{ type: "authorization-requested", at: T0 }]);
    const later = applyEvent(blocked, {
      type: "time-passed",
      at: T0 + REST_AFTER_MS * 10,
    });

    expect(later.state).toBe("needsYou");
  });
});

describe("transients come and go", () => {
  it("holds a transient through its display window", () => {
    const thinking = run([{ type: "prompt-submitted", at: T0 }]);
    const held = applyEvent(thinking, { type: "time-passed", at: T0 + TRANSIENT_WINDOW_MS - 1 });

    expect(held.state).toBe("thinking");
  });

  it("returns the success state to ambient rather than letting it persist", () => {
    const working = run([
      { type: "prompt-submitted", at: T0 },
      { type: "tool-activity", at: T0 + 100, signals: { elapsedMs: 2_000, payloadBytes: 4_000 } },
      { type: "completed", at: T0 + 5_000 },
    ]);
    expect(working.state).toBe("success");

    const after = applyEvent(working, {
      type: "time-passed",
      at: T0 + 5_000 + TRANSIENT_WINDOW_MS,
    });

    expect(after.state).toBe("working");
    expect(after.state).not.toBe("success");
  });

  it("returns the thinking state to the idle it interrupted", () => {
    const thinking = run([{ type: "prompt-submitted", at: T0 }]);
    const after = applyEvent(thinking, {
      type: "time-passed",
      at: T0 + TRANSIENT_WINDOW_MS,
    });

    expect(after.state).toBe("idle");
  });
});

describe("answering a block", () => {
  it("clears the block and resumes the agent", () => {
    const blocked = run([{ type: "authorization-requested", at: T0 }]);
    const answered = applyEvent(blocked, { type: "answered", at: T0 + 4_000 });

    expect(answered.state).toBe("thinking");
    expect(answered.block).toBeNull();
  });

  it("does nothing when nothing was blocked", () => {
    const working = run([{ type: "prompt-submitted", at: T0 }]);
    expect(applyEvent(working, { type: "answered", at: T0 + 1 })).toBe(working);
  });
});