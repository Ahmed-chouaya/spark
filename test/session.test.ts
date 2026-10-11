import { describe, expect, it } from "vitest";
import {
  createSession,
  selectPrimary,
  type AgentSession,
} from "../src/state-selection/session";

/** A session with everything defaulted except what the test cares about. */
const session = (
  sessionId: string,
  overrides: Partial<AgentSession> = {}
): AgentSession => ({ ...createSession("claude-code", sessionId, 0), ...overrides });

describe("the primary session is the most recently active one", () => {
  it("returns the session when several exist", () => {
    const sessions = [
      session("a", { lastActiveAt: 10 }),
      session("b", { lastActiveAt: 30 }),
      session("c", { lastActiveAt: 20 }),
    ];

    expect(selectPrimary(sessions)?.sessionId).toBe("b");
  });

  it("returns nothing when none exist", () => {
    expect(selectPrimary([])).toBeUndefined();
  });

  it("picks the session the user most recently gave work to", () => {
    // The user moves from a to b: b is primary purely because it was the last
    // session to receive a prompt.
    let sessions = [session("a", { lastActiveAt: 10 }), session("b", { lastActiveAt: 5 })];
    expect(selectPrimary(sessions)?.sessionId).toBe("a");

    sessions = [sessions[0]!, session("b", { lastActiveAt: 25 })];
    expect(selectPrimary(sessions)?.sessionId).toBe("b");
  });

  it("prefers a session with activity over one that has never had any", () => {
    const sessions = [session("cold"), session("warm", { lastActiveAt: 1 })];

    expect(selectPrimary(sessions)?.sessionId).toBe("warm");
  });

  it("keeps a never-used session primary when it is the only one", () => {
    // The common single-session case, and the reason no special case is needed.
    expect(selectPrimary([session("only")])?.sessionId).toBe("only");
  });

  it("prefers the earliest-listed session when timestamps tie", () => {
    // The host gave us nothing to order by, so the answer must come from the
    // input rather than from how a sort happened to be stable.
    const sessions = [
      session("first", { lastActiveAt: 7 }),
      session("second", { lastActiveAt: 7 }),
      session("third", { lastActiveAt: 7 }),
    ];

    expect(selectPrimary(sessions)?.sessionId).toBe("first");
  });

  it("covers equal, differing and absent timestamps together", () => {
    const sessions = [
      session("absent"),
      session("earlier", { lastActiveAt: 4 }),
      session("same-as-earlier", { lastActiveAt: 4 }),
      session("later", { lastActiveAt: 9 }),
    ];

    expect(selectPrimary(sessions)?.sessionId).toBe("later");
    expect(selectPrimary([sessions[0]!, sessions[1]!])?.sessionId).toBe("earlier");
    expect(selectPrimary([sessions[0]!])?.sessionId).toBe("absent");
    // Equal timestamps tie, and the earlier-listed session wins the tie.
    expect(selectPrimary([sessions[1]!, sessions[2]!])?.sessionId).toBe("earlier");
  });
});