import { describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot/types";
import {
  createClaudeCodeAdapter,
  type ClaudeCodePayload,
} from "../src/state-selection/adapters/claude-code";
import { PRECEDENCE, outranks } from "../src/state-selection/classification";
import { escalates, isLoud } from "../src/state-selection/escalation";
import { REST_AFTER_MS, TRANSIENT_WINDOW_MS } from "../src/state-selection/events";
import { selectState } from "../src/state-selection/reduce";
import { selectPrimary, type AgentSession } from "../src/state-selection/session";
import { applyPayload } from "../src/state-selection/track";

/**
 * One pass over the whole pipeline — payloads, adapter, sessions, reduction —
 * asserting every scenario the spec states. Nothing below the adapter is mocked,
 * and there is no rendering, window or IPC anywhere in the path.
 */

const T0 = 1_000_000;

let clock = T0;
const adapter = createClaudeCodeAdapter(() => clock);

const hook = (
  hook_event_name: string,
  at: number,
  overrides: Partial<ClaudeCodePayload> = {}
): ClaudeCodePayload => ({
  hook_event_name,
  session_id: "a",
  timestamp: at,
  ...overrides,
});

/** A scripted world: sessions as they accumulate, payloads as the relay sends them. */
class World {
  private sessions: readonly AgentSession[] = [];

  send(
    sessionId: string,
    hookEvent: string,
    at: number,
    overrides: Partial<ClaudeCodePayload> = {}
  ): this {
    clock = at;
    this.sessions = applyPayload(this.sessions, adapter, {
      ...hook(hookEvent, at, overrides),
      session_id: sessionId,
    });
    return this;
  }

  /** A session exists, and the user gives it work. */
  turn(sessionId: string, at: number): this {
    return this.send(sessionId, "SessionStart", at).send(sessionId, "UserPromptSubmit", at + 1);
  }

  /** Work starts for a session. */
  tool(sessionId: string, at: number): this {
    return this.send(sessionId, "PreToolUse", at, {
      tool_use_id: `${sessionId}-1`,
      tool_input: { cmd: "ls" },
    });
  }

  /** The clock advances with nothing happening, the way a quiet relay tick does. */
  idleUntil(at: number): this {
    clock = at;
    for (const session of this.sessions) {
      this.sessions = applyPayload(this.sessions, adapter, {
        ...hook("Notification", at, { notification_type: "idle_prompt" }),
        session_id: session.sessionId,
      });
    }
    return this;
  }

  get rendered(): ReturnType<typeof selectState> {
    return selectState(this.sessions);
  }

  get live(): readonly AgentSession[] {
    return this.sessions;
  }

  session(sessionId: string): AgentSession {
    const found = this.sessions.find((s) => s.sessionId === sessionId);
    if (!found) throw new Error(`no session ${sessionId}`);
    return found;
  }
}

describe("every spec scenario, in one pass", () => {
  it("renders one state, whatever is live", () => {
    expect(new World().rendered).toBe("idle");

    const world = new World()
      .turn("a", T0)
      .tool("a", T0 + 20)
      .send("b", "SessionStart", T0 + 5)
      .send("c", "SessionStart", T0 + 6)
      .turn("c", T0 + 7);

    // Three live sessions, one rendered state, no per-session representation.
    expect(world.live).toHaveLength(3);
    expect(MASCOT_STATES).toContain(world.rendered);
  });

  it("puts a blocked session above everything else", () => {
    const world = new World()
      .turn("a", T0)
      .tool("a", T0 + 20)
      .turn("b", T0 + 30)
      .send("b", "Notification", T0 + 40, { notification_type: "permission_prompt" });

    expect(world.session("a").state).toBe("working");
    expect(world.rendered).toBe("needsYou");

    const allBlocked = new World()
      .send("a", "Notification", T0, { notification_type: "permission_prompt" })
      .send("b", "Notification", T0 + 1, { notification_type: "permission_prompt" });
    expect(allBlocked.rendered).toBe("needsYou");
  });

  it("lets only the primary drive ambient state", () => {
    // The user drove `primary`, finished the turn, and is sitting with it idle.
    // An older session is still churning in the background.
    const world = new World()
      .turn("background", T0 - 100)
      .tool("background", T0 - 50)
      .turn("primary", T0)
      .send("primary", "Stop", T0 + 20)
      .idleUntil(T0 + 20 + TRANSIENT_WINDOW_MS)
      .tool("background", T0 + 30);

    expect(selectPrimary(world.live)?.sessionId).toBe("primary");
    expect(world.session("primary").state).toBe("idle");
    expect(world.session("background").state).toBe("working");
    expect(world.rendered).toBe("idle");
  });

  it("does not surface a background session's failure", () => {
    const world = new World()
      .turn("background", T0 - 100)
      .turn("primary", T0)
      .send("primary", "Stop", T0 + 20)
      .idleUntil(T0 + 20 + TRANSIENT_WINDOW_MS)
      .send("background", "Stop", T0 + 30, { error: { message: "boom" } });

    expect(world.session("background").state).toBe("alert");
    expect(isLoud("alert")).toBe(true);
    // The accepted cost: the failure is finished news, so it is not surfaced.
    expect(world.rendered).toBe("idle");
  });

  it("follows the user when they switch sessions", () => {
    const world = new World().turn("a", T0).turn("b", T0 + 500);

    expect(selectPrimary(world.live)?.sessionId).toBe("b");
    expect(world.rendered).toBe("thinking");
  });

  it("returns to the still-primary session after a block is answered", () => {
    const world = new World()
      .turn("primary", T0)
      .turn("waiting", T0 - 100)
      .send("waiting", "Notification", T0 - 90, {
        notification_type: "permission_prompt",
      });

    expect(world.rendered).toBe("needsYou");
    expect(selectPrimary(world.live)?.sessionId).toBe("primary");

    // The user answers: the work the session was blocked on runs again.
    const answered = world.tool("waiting", T0 + 10);

    expect(answered.session("waiting").block).toBeNull();
    expect(answered.session("waiting").state).toBe("working");
    // Answering finishes the session they stepped over to. It does not make it
    // the one they were driving.
    expect(selectPrimary(answered.live)?.sessionId).toBe("primary");
    expect(answered.rendered).toBe("thinking");
  });

  it("escalates the block and not the fault", () => {
    const blocked = new World()
      .turn("a", T0)
      .send("a", "Notification", T0 + 20, { notification_type: "permission_prompt" });
    expect(escalates(blocked.session("a"))).toBe(true);

    const failed = new World()
      .turn("a", T0)
      .send("a", "Stop", T0 + 20, { error: { message: "boom" } });
    expect(escalates(failed.session("a"))).toBe(false);
  });

  it("does not escalate a question it cannot answer", () => {
    const asked = new World()
      .turn("a", T0)
      .send("a", "Notification", T0 + 20, { notification_type: "elicitation_dialog" });

    expect(asked.session("a").state).toBe("needsYou");
    expect(escalates(asked.session("a"))).toBe(false);

    const askedForAccess = new World()
      .turn("a", T0)
      .send("a", "Notification", T0 + 20, { notification_type: "permission_prompt" });
    expect(escalates(askedForAccess.session("a"))).toBe(true);
  });

  it("lets transients revert and sustained states hold", () => {
    const world = new World().turn("a", T0).tool("a", T0 + 20);
    expect(world.rendered).toBe("working");

    // A sustained state holds through the clock.
    world.idleUntil(T0 + TRANSIENT_WINDOW_MS * 10);
    expect(world.rendered).toBe("working");

    const finished = world.send("a", "Stop", T0 + 30_000);
    expect(finished.rendered).toBe("success");

    // A transient goes back to what it interrupted rather than persisting.
    finished.idleUntil(T0 + 30_000 + TRANSIENT_WINDOW_MS);
    expect(finished.rendered).toBe("working");
  });

  it("rests only when nothing has happened for a long time", () => {
    const world = new World().turn("a", T0);
    expect(world.rendered).toBe("thinking");

    // The thinking state gives way on its own, well before the rest threshold.
    world.idleUntil(T0 + TRANSIENT_WINDOW_MS + 10);
    expect(world.rendered).toBe("idle");

    // A clock tick is not activity, so the silence is measured from the last
    // event that actually happened — the prompt, one millisecond in.
    world.idleUntil(T0 + REST_AFTER_MS);
    expect(world.rendered).toBe("idle");

    world.idleUntil(T0 + REST_AFTER_MS + 1);
    expect(world.rendered).toBe("tired");
  });

  it("orders competing states by the derived precedence, not by arrival", () => {
    expect([...PRECEDENCE]).toEqual(["block", "fault", "transient", "sustained", "idle"]);
    expect(outranks("needsYou", "alert")).toBe(true);
    expect(outranks("alert", "success")).toBe(true);
    expect(outranks("success", "working")).toBe(true);
    expect(outranks("working", "idle")).toBe(true);

    // ... while a later event still wins over an older sustained state, because
    // the ladder ranks competing claims and not the passage of time.
    const world = new World()
      .turn("a", T0)
      .tool("a", T0 + 20)
      .send("a", "Stop", T0 + 100)
      .turn("a", T0 + 200)
      .tool("a", T0 + 300);
    expect(world.rendered).toBe("working");
  });

  it("handles a tool it has never seen, and one added later", () => {
    // `tool_name` is not a field the adapter's payload type has, which is the
    // point: there is nowhere for a per-tool decision to be written down.
    const withUnknownTool = {
      ...hook("PreToolUse", T0 + 20, {
        tool_use_id: "a1",
        tool_input: { novel: true },
      }),
      tool_name: "SomethingShippedAfterWeDid",
    } as Partial<ClaudeCodePayload>;

    const brandNewTool = new World()
      .turn("a", T0)
      .send("a", "PreToolUse", T0 + 20, withUnknownTool);

    expect(MASCOT_STATES).toContain(brandNewTool.rendered);
    expect(brandNewTool.rendered).toBe("working");
  });

  it("survives an event the adapter does not model", () => {
    const world = new World()
      .turn("a", T0)
      .tool("a", T0 + 20)
      .send("a", "SubagentStop", T0 + 30)
      .send("a", "Stop", T0 + 40);

    expect(world.rendered).toBe("success");
  });
});