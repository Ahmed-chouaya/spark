import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeCodeSource, createSessionSource } from "../src/relay/session-source";
import { MASCOT_STATES, type MascotState } from "../src/components/mascot/types";
import { escalates } from "../src/state-selection/escalation";
import { REST_AFTER_MS, TRANSIENT_WINDOW_MS } from "../src/state-selection/events";
import { selectState } from "../src/state-selection/reduce";
import { selectPrimary } from "../src/state-selection/session";
import { applyPayload } from "../src/state-selection/track";
import { createClaudeCodeAdapter, type ClaudeCodePayload } from "../src/state-selection/adapters/claude-code";
import type { AgentAdapter, CanonicalUpdate } from "../src/state-selection/adapters/types";
import type { AgentSession } from "../src/state-selection/session";

/**
 * A session started in a terminal, reaching the companion without being told.
 *
 * The claim under test throughout is that *only where sessions come from*
 * changed. Every state below is reached by handing raw host payloads to
 * `receive` and then asking the reduction what to render — never by asking the
 * source what to render, because it does not answer that question.
 */

const T0 = 1_000_000;

/** A payload as the host writes it, arriving as bytes. */
const bytes = (payload: ClaudeCodePayload): Buffer =>
  Buffer.from(JSON.stringify(payload), "utf8");

const hook = (
  hook_event_name: string,
  at: number,
  overrides: Partial<ClaudeCodePayload> = {}
): ClaudeCodePayload => ({
  hook_event_name,
  session_id: "s1",
  timestamp: at,
  ...overrides,
});

/** A source on a fixed clock, driven by payloads the way the relay delivers them. */
const source = (at = T0, initial: readonly AgentSession[] = []) =>
  createClaudeCodeSource(initial, () => at);

/** Deliver a sequence of payloads and return the sessions they produced. */
const driven = (
  payloads: ClaudeCodePayload[],
  initial: readonly AgentSession[] = []
): readonly AgentSession[] => {
  const sessions = source(T0, initial);
  for (const payload of payloads) sessions.receive(bytes(payload));
  return sessions.sessions;
};

/** The state the reduction renders after driving those payloads. */
const rendered = (payloads: ClaudeCodePayload[], initial?: readonly AgentSession[]) =>
  selectState(driven(payloads, initial));

describe("a session started by the host reaches the companion", () => {
  it("arrives with no caller supplying it", () => {
    // Nothing is passed in and nothing is created by hand: the only thing that
    // happened is that a payload arrived, exactly as it will when the user's
    // agent starts a session.
    const sessions = driven([hook("SessionStart", T0)]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.agent).toBe("claude-code");
    expect(sessions[0]?.sessionId).toBe("s1");
    expect(sessions[0]?.state).toBe("idle");
  });

  it("is fed through the existing adapter and fold, not around them", () => {
    // The same pipeline a caller-supplied payload has always taken. Driving it
    // by hand and driving it through the relay produce the same sessions, which
    // is what "the source changed, the rules did not" means in practice.
    const payloads = [hook("SessionStart", T0), hook("UserPromptSubmit", T0 + 100)];

    const adapter = createClaudeCodeAdapter(() => T0);
    const byHand = payloads.reduce<readonly AgentSession[]>(
      (live, payload) => applyPayload(live, adapter, payload),
      []
    );

    expect(driven(payloads)).toEqual(byHand);
  });

  it("folds several sessions arriving at once", () => {
    const live = source(T0);

    for (const id of ["a", "b", "c"]) {
      live.receive(bytes({ ...hook("SessionStart", T0), session_id: id }));
      live.receive(bytes({ ...hook("UserPromptSubmit", T0), session_id: id }));
    }

    expect(live.sessions).toHaveLength(3);
    expect(live.sessions.map((session) => session.sessionId).sort()).toEqual(["a", "b", "c"]);
    expect(live.sessions.every((session) => session.state === "thinking")).toBe(true);
  });

  it("keeps the sessions a caller already supplied", () => {
    // The relay is additive. A companion used without it keeps working, and a
    // companion with it does not lose the sessions it already had.
    const existing: AgentSession = {
      agent: "claude-code",
      sessionId: "manual",
      state: "thinking",
      ambient: "thinking",
      lastActiveAt: T0,
      lastEventAt: T0,
      block: null,
      enteredAt: T0,
    };

    const sessions = driven([hook("SessionStart", T0)], [existing]);

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.sessionId).sort()).toEqual(["manual", "s1"]);
  });
});

describe("the reduction still decides", () => {
  it("reaches every state in the vocabulary from host payloads alone", () => {
    const reach: Record<MascotState, ClaudeCodePayload[]> = {
      idle: [hook("SessionStart", T0)],
      thinking: [hook("UserPromptSubmit", T0)],
      working: [
        hook("UserPromptSubmit", T0),
        hook("PreToolUse", T0 + 10, { tool_use_id: "t1", tool_input: { cmd: "ls" } }),
      ],
      success: [hook("Stop", T0)],
      focused: [
        hook("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
        hook("PostToolUse", T0 + 60_000, { tool_use_id: "t1", tool_response: {} }),
      ],
      alert: [hook("Stop", T0, { error: { message: "boom" } })],
      listening: [
        hook("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
        hook("PostToolUse", T0 + 40, { tool_use_id: "t1", tool_response: {} }),
      ],
      tired: [
        hook("SessionStart", T0),
        hook("Notification", T0 + REST_AFTER_MS, { notification_type: "idle_prompt" }),
      ],
      needsYou: [hook("Notification", T0, { notification_type: "permission_prompt" })],
    };

    expect(Object.keys(reach).sort()).toEqual([...MASCOT_STATES].sort());
    for (const state of MASCOT_STATES) {
      expect(rendered(reach[state]), state).toBe(state);
    }
  });

  it("keeps the precedence rule: a blocked session outranks everything", () => {
    const sessions = driven([
      hook("UserPromptSubmit", T0),
      hook("PreToolUse", T0 + 10, { tool_use_id: "t1", tool_input: {} }),
      hook("Notification", T0 + 20, { notification_type: "permission_prompt" }),
    ]);

    // Mid-task, and outranked anyway: a blocked session has stopped and costs
    // wall-clock until the user answers it.
    expect(sessions.find((session) => session.sessionId === "s1")?.state).toBe("needsYou");
    expect(selectState(sessions)).toBe("needsYou");
  });

  it("keeps primary selection following the user's most recent turn", () => {
    const live = source(T0);
    for (const payload of [
      hook("UserPromptSubmit", T0),
      { ...hook("UserPromptSubmit", T0 + 500), session_id: "s2" },
    ]) {
      live.receive(bytes(payload));
    }

    expect(selectPrimary(live.sessions)?.sessionId).toBe("s2");
    expect(selectState(live.sessions)).toBe("thinking");
  });

  it("keeps the classification rules: effort is measured, never named", () => {
    const heavy = driven([
      hook("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
      hook("PostToolUse", T0 + 60_000, { tool_use_id: "t1", tool_response: {} }),
    ]);
    const light = driven([
      hook("PreToolUse", T0, { tool_use_id: "t1", tool_input: {} }),
      hook("PostToolUse", T0 + 5, { tool_use_id: "t1", tool_response: {} }),
    ]);

    expect(heavy[0]?.state).toBe("focused");
    expect(light[0]?.state).toBe("listening");
    // Two different tools of similar effort are allowed to render the same face.
    // The transport contributed nothing to which bucket this fell into.
    const otherTool = driven([
      hook("PreToolUse", T0, { tool_use_id: "t1", tool_input: {}, tool_name: "Read" } as never),
      hook("PostToolUse", T0 + 60_000, { tool_use_id: "t1", tool_response: {}, tool_name: "Read" } as never),
    ]);
    expect(otherTool[0]?.state).toBe("focused");
  });

  it("keeps the escalation rule: actionable blocks escalate, questions do not", () => {
    const actionable = driven([
      hook("UserPromptSubmit", T0),
      hook("Notification", T0 + 10, { notification_type: "permission_prompt" }),
    ]);
    const question = driven([
      hook("UserPromptSubmit", T0),
      hook("Notification", T0 + 10, { notification_type: "elicitation_dialog" }),
    ]);
    const fault = driven([
      hook("UserPromptSubmit", T0),
      hook("Stop", T0 + 10, { error: { message: "boom" } }),
    ]);

    expect(escalates(actionable[0]!)).toBe(true);
    expect(escalates(question[0]!)).toBe(false);
    expect(escalates(fault[0]!)).toBe(false);
  });

  it("keeps transients reverting and sustained states holding", () => {
    const live = source(T0);
    for (const payload of [
      hook("UserPromptSubmit", T0),
      hook("PreToolUse", T0 + 10, { tool_use_id: "t1", tool_input: { cmd: "ls" } }),
    ]) {
      live.receive(bytes(payload));
    }
    expect(selectState(live.sessions)).toBe("working");

    live.receive(bytes({ ...hook("Stop", T0 + 30_000), session_id: "s1" }));
    expect(selectState(live.sessions)).toBe("success");

    live.receive(bytes({
      ...hook("Notification", T0 + 30_000 + TRANSIENT_WINDOW_MS),
      notification_type: "idle_prompt",
    }));
    // A transient goes back to what it interrupted rather than persisting.
    expect(selectState(live.sessions)).toBe("working");
  });

  it("has no second path that decides the rendered state", () => {
    const sourceFile = readFileSync(
      join(import.meta.dirname, "../src/relay/session-source.ts"),
      "utf8"
    );

    // The transport holds no rules. If it consulted the precedence ladder,
    // ranked sessions, or asked whether a block was actionable, there would be
    // a second answer to a question that currently has exactly one.
    for (const term of [
      "selectState",
      "PRECEDENCE",
      "escalates",
      "classify",
      "selectPrimary",
      "outranks",
    ]) {
      expect(sourceFile, term).not.toContain(term);
    }

    // And it holds no state vocabulary of its own either — only the two imports
    // that are allowed to know anything about sessions.
    const imports = [...sourceFile.matchAll(/^import[\s\S]*?;$/gm)].map((m) => m[0]);
    for (const statement of imports) {
      expect(statement).toMatch(/state-selection|node:/);
    }
  });
});

describe("a second host agent changes nothing here", () => {
  it("is added as another adapter, and the source is unchanged", () => {
    // A host v0.1 does not have, written here to show the shape. It translates
    // its own names and nothing else has to know they exist.
    const other: AgentAdapter<{ session_id: string; kind: string }> = {
      agent: "other-agent",
      translate: (payload): CanonicalUpdate | null =>
        payload.kind === "began"
          ? { sessionId: payload.session_id, event: { type: "session-started", at: T0 } }
          : null,
    };

    const sessions = createSessionSource({
      adapter: other as never,
      initial: [],
    });
    sessions.receive(JSON.stringify({ session_id: "o1", kind: "began" }));

    expect(sessions.sessions).toHaveLength(1);
    expect(sessions.sessions[0]?.agent).toBe("other-agent");
    expect(sessions.sessions[0]?.state).toBe("idle");

    // Same reduction, same answer: a session that began renders as idle whoever
    // reported it.
    expect(selectState(sessions.sessions)).toBe("idle");
  });

  it("leaves the host's vocabulary in exactly one file that interprets it", () => {
    // The whole point of the adapter boundary: one file turns a host's event
    // names into ours, and a second host is one more file beside it.
    //
    // The test is for the two vocabularies *together*, because a file holding
    // both is the shape of a second implementation — it knows what the host
    // calls a thing and what the companion calls it. Naming an event without
    // translating it is a different thing entirely: the installer has to say
    // `SessionStart` out loud to register a hook for it, and is still not
    // interpreting anything.
    const SRC = join(import.meta.dirname, "../src");
    const hostVocabulary = [
      "hook_event_name",
      "notification_type",
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "permission_prompt",
      "elicitation_dialog",
      "idle_prompt",
    ];
    const canonicalVocabulary = [
      "session-started",
      "prompt-submitted",
      "tool-activity",
      "authorization-requested",
      "agent-question",
      "time-passed",
    ];

    const sources = readdirSync(SRC, { recursive: true, encoding: "utf8" })
      .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
      .map((path) => ({
        path,
        code: readFileSync(join(SRC, path), "utf8")
          // Comments are prose about the rule, not the rule. The relay's own
          // source argues at length for why it translates nothing, and names
          // the vocabulary while doing so.
          .replace(/\/\*[\s\S]*?\*\//g, " ")
          .replace(/^\s*\/\/.*$/gm, " "),
      }));

    const translating = sources
      .filter(
        ({ code }) =>
          hostVocabulary.some((term) => code.includes(term)) &&
          canonicalVocabulary.some((term) => code.includes(term))
      )
      .map(({ path }) => path);

    expect(translating).toEqual(["state-selection/adapters/claude-code.ts"]);

    // The installer names events to register hooks for and must not learn what
    // any of them means.
    const installer = sources.find(({ path }) => path === "relay/install.ts")!.code;
    expect(hostVocabulary.some((term) => installer.includes(term))).toBe(true);
    expect(canonicalVocabulary.some((term) => installer.includes(term))).toBe(false);
  });

  it("leaves the relay untouched by any of it", () => {
    // The relay has no second-host support to add, because it never had host
    // support to begin with. It moves the host's bytes; the companion decides
    // what they mean.
    const relay = readFileSync(join(import.meta.dirname, "../relay/src/main.rs"), "utf8")
      .replace(/\/\/[\s\S]*$/gm, "");

    expect(relay).not.toMatch(/other-agent|adapter|translate|canonical/i);
  });
});

describe("the caller-supplied route still works", () => {
  it("is untouched by the relay path existing", () => {
    // No channel, no relay, no installation: a caller hands sessions over
    // directly and the companion is fully usable. This is what makes the relay
    // removable without taking anything with it.
    const adapter = createClaudeCodeAdapter(() => T0);
    const sessions = applyPayload([], adapter, hook("UserPromptSubmit", T0));

    expect(sessions).toHaveLength(1);
    expect(selectState(sessions)).toBe("thinking");
  });

  it("accepts a caller-supplied session list into a relay-fed source", () => {
    const existing: AgentSession = {
      agent: "claude-code",
      sessionId: "manual",
      state: "working",
      ambient: "working",
      lastActiveAt: T0,
      lastEventAt: T0,
      block: null,
      enteredAt: T0,
    };

    const live = source(T0, [existing]);
    live.receive(bytes({ ...hook("UserPromptSubmit", T0 + 500), session_id: "s1" }));

    // The user's most recent turn decides which one the mascot speaks for.
    expect(live.sessions).toHaveLength(2);
    expect(selectPrimary(live.sessions)?.sessionId).toBe("s1");
  });
});

describe("an unusable payload reaches nothing", () => {
  it("changes no sessions, for anything that is not a JSON object", () => {
    const before = driven([hook("UserPromptSubmit", T0)]);
    const live = source(T0, before);

    // Bytes, truncated JSON, and valid JSON that is not an object.
    for (const payload of [
      "not json",
      '{"hook_event_name":',
      "[1, 2, 3]",
      '"a string"',
      "42",
      "null",
      "",
      Buffer.from([0xff, 0xfe, 0x00]),
    ]) {
      live.receive(payload);
    }

    expect(live.sessions).toEqual(before);
  });

  it("does not throw on any of it", () => {
    const live = source(T0);

    // Nothing reaches the host agent either: the relay has already exited by
    // the time any of this is decided.
    expect(() => live.receive("")).not.toThrow();
    expect(() => live.receive(Buffer.alloc(0))).not.toThrow();
  });

  it("hands a payload with no fields the adapter to refuse, not a guess", () => {
    // An object with nothing in it is well-formed, so it reaches the adapter —
    // which has an opinion about events it does not model, and says nothing.
    const sessions = driven([{} as ClaudeCodePayload]);

    expect(sessions).toEqual([]);
  });
});