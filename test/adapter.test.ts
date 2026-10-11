import { describe, expect, it } from "vitest";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";
import {
  createClaudeCodeAdapter,
  type ClaudeCodePayload,
} from "../src/state-selection/adapters/claude-code";
import type { AgentAdapter } from "../src/state-selection/adapters/types";
import { REST_AFTER_MS } from "../src/state-selection/events";
import { selectState } from "../src/state-selection/reduce";
import { applyPayload } from "../src/state-selection/track";
import type { AgentSession } from "../src/state-selection/session";

const T0 = 10_000;

/** A payload of the shape Claude Code emits, with only what a test needs. */
const payload = (
  hook_event_name: string,
  at: number,
  overrides: Partial<ClaudeCodePayload> = {}
): ClaudeCodePayload => ({
  hook_event_name,
  session_id: "s1",
  timestamp: at,
  ...overrides,
});

/** Drive payloads through the adapter and return the sessions they produce. */
const drive = (
  payloads: ClaudeCodePayload[],
  sessions: readonly AgentSession[] = []
): readonly AgentSession[] => {
  const adapter = createClaudeCodeAdapter(() => T0);
  return payloads.reduce<readonly AgentSession[]>(
    (live, p) => applyPayload(live, adapter, p),
    sessions
  );
};

/** The state the reduction renders after driving payloads. */
const rendered = (payloads: ClaudeCodePayload[], sessions?: readonly AgentSession[]) =>
  selectState(drive(payloads, sessions));

describe("the Claude Code adapter", () => {
  it("translates lifecycle events into canonical sessions", () => {
    const adapter = createClaudeCodeAdapter(() => T0);

    expect(adapter.agent).toBe("claude-code");
    expect(adapter.translate(payload("UserPromptSubmit", T0))).toEqual({
      sessionId: "s1",
      event: { type: "prompt-submitted", at: T0 },
    });
  });

  it("says nothing about events it does not model", () => {
    const adapter = createClaudeCodeAdapter(() => T0);

    // Hosts emit more than we care about. The correct reading of an event we do
    // not model is silence, not a guess.
    expect(adapter.translate(payload("SubagentStop", T0))).toBeNull();
    expect(adapter.translate(payload("PreCompact", T0))).toBeNull();
    expect(
      adapter.translate(payload("Notification", T0, { notification_type: "something_new" }))
    ).toBeNull();
  });

  it("namespaces sessions by agent, so two hosts cannot collide", () => {
    // The seam this module exists to protect: a second agent arrives as another
    // adapter, and its session ids are kept apart from the first agent's even
    // when they happen to be the same string.
    const claude = createClaudeCodeAdapter(() => T0);
    const foreign: AgentAdapter<ClaudeCodePayload> = {
      agent: "some-other-agent",
      translate: (p) => ({ sessionId: p.session_id, event: { type: "session-started", at: p.timestamp ?? T0 } }),
    };

    const sessions = applyPayload([], claude, payload("UserPromptSubmit", T0));
    const withForeign = applyPayload(sessions, foreign, payload("UserPromptSubmit", T0));

    expect(withForeign).toHaveLength(2);
    expect(withForeign.map((s) => `${s.agent}:${s.sessionId}`)).toEqual([
      "claude-code:s1",
      "some-other-agent:s1",
    ]);
    // The Claude Code session was given work; the other one was only seen.
    expect(withForeign[0]?.state).toBe("thinking");
    expect(withForeign[1]?.state).toBe("idle");
  });
});

describe("representative event sequences reduce to the documented states", () => {
  it("walks a turn from prompt to success", () => {
    const states = [
      payload("SessionStart", T0),
      payload("UserPromptSubmit", T0 + 1_000),
      payload("PreToolUse", T0 + 1_200, { tool_use_id: "t1", tool_input: { a: 1 } }),
      payload("PostToolUse", T0 + 1_400, { tool_use_id: "t1", tool_response: { ok: true } }),
      payload("Stop", T0 + 4_000),
    ];

    expect(rendered(states)).toBe("success");
  });

  it("renders working while a tool is running", () => {
    const states = [
      payload("SessionStart", T0),
      payload("UserPromptSubmit", T0 + 1_000),
      payload("PreToolUse", T0 + 1_200, { tool_use_id: "t1", tool_input: { a: 1 } }),
    ];

    expect(rendered(states)).toBe("working");
  });

  it("renders the fault state when the turn fails", () => {
    const states = [
      payload("UserPromptSubmit", T0),
      payload("Stop", T0 + 2_000, { error: { message: "boom" } }),
    ];

    expect(rendered(states)).toBe("alert");
  });

  it("renders the blocked state for an authorisation request", () => {
    const states = [
      payload("UserPromptSubmit", T0),
      payload("Notification", T0 + 1_000, { notification_type: "permission_prompt" }),
    ];

    expect(rendered(states)).toBe("needsYou");
  });

  it("blocks without escalating for a question it cannot answer", () => {
    const states = [
      payload("UserPromptSubmit", T0),
      payload("Notification", T0 + 1_000, { notification_type: "elicitation_dialog" }),
    ];

    const sessions = drive(states);
    expect(selectState(sessions)).toBe("needsYou");
  });

  it("rests when the host reports the session has gone quiet", () => {
    const states = [
      payload("SessionStart", T0),
      payload("Notification", T0 + REST_AFTER_MS, { notification_type: "idle_prompt" }),
    ];

    expect(rendered(states)).toBe("tired");
  });
});

describe("all nine states are reachable from this adapter alone", () => {
  /** One representative payload sequence per state. */
  const REACH: Record<MascotState, ClaudeCodePayload[]> = {
    idle: [payload("SessionStart", T0)],
    thinking: [payload("UserPromptSubmit", T0)],
    working: [
      payload("UserPromptSubmit", T0),
      payload("PreToolUse", T0 + 10, { tool_use_id: "t1", tool_input: { cmd: "ls" } }),
    ],
    success: [payload("Stop", T0)],
    focused: [
      payload("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
      payload("PostToolUse", T0 + 60_000, { tool_use_id: "t1", tool_response: {} }),
    ],
    alert: [payload("Stop", T0, { error: { message: "boom" } })],
    listening: [
      payload("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
      payload("PostToolUse", T0 + 40, { tool_use_id: "t1", tool_response: { lines: 3 } }),
    ],
    tired: [
      payload("SessionStart", T0),
      payload("Notification", T0 + REST_AFTER_MS, { notification_type: "idle_prompt" }),
    ],
    needsYou: [
      payload("Notification", T0, { notification_type: "permission_prompt" }),
    ],
  };

  it("reaches every state in the vocabulary", () => {
    expect(Object.keys(REACH).sort()).toEqual([...MASCOT_STATES].sort());

    for (const state of MASCOT_STATES) {
      expect(rendered(REACH[state]), state).toBe(state);
    }
  });

  it("reaches them with no operating-system integration", () => {
    // Every state above is produced from hook payloads alone: no window, no
    // focus query, no terminal introspection, no platform API of any kind.
    for (const state of MASCOT_STATES) {
      const sessions = drive(REACH[state]);
      expect(sessions, state).toHaveLength(1);
      expect(sessions[0]?.state, state).toBe(state);
    }
  });
});