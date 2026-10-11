import { describe, expect, it } from "vitest";
import {
  decide,
  dismiss,
  longestWaiting,
  supersede,
  type Decision,
  type PendingRequest,
} from "../src/escalation/pending";

/**
 * The pending decision model.
 *
 * Every rule here is about identity: which request is offered, and what a
 * decision made for one request is allowed to resolve. The failure this guards
 * against is a decision arriving for work that has gone away and being applied
 * to whatever is pending instead, so each refusal is asserted on what it does
 * *not* do as well as on what it does.
 */

const T0 = 1_000;

const request = (
  id: string,
  sessionId: string,
  requestedAt: number = T0
): PendingRequest => ({
  id,
  operation: `run the thing for ${sessionId}`,
  sessionId,
  requestedAt,
});

const ids = (pending: readonly PendingRequest[]): string[] => pending.map((p) => p.id);

describe("a pending request carries what a decision has to be bound to", () => {
  it("holds the operation, the session it belongs to, and its own identity", () => {
    const subject = request("req-1", "session-a");

    expect(subject.operation).toBe("run the thing for session-a");
    expect(subject.sessionId).toBe("session-a");
    expect(subject.id).toBe("req-1");
  });

  it("keeps an identity distinct from the session it came from", () => {
    // The session is where it belongs; the request is what is being decided.
    // Collapsing the two is what makes a late decision land on the wrong work.
    const first = request("req-1", "session-a");
    const second = request("req-2", "session-a");

    expect(first.sessionId).toBe(second.sessionId);
    expect(first.id).not.toBe(second.id);
  });
});

describe("the longest-waiting request is offered", () => {
  it("offers the one that has been waiting longest of two", () => {
    const older = request("older", "session-a", T0);
    const newer = request("newer", "session-b", T0 + 500);

    expect(longestWaiting([newer, older])?.id).toBe("older");
    expect(longestWaiting([older, newer])?.id).toBe("older");
  });

  it("offers the only one when just one is blocked", () => {
    const only = request("only", "session-a");

    expect(longestWaiting([only])?.id).toBe("only");
  });

  it("offers nothing when nothing is blocked", () => {
    expect(longestWaiting([])).toBeNull();
  });

  it("keeps the earlier-listed request when two have waited equally long", () => {
    // Equal timestamps mean the host gave nothing to order by, so the answer is
    // a function of the input rather than of a sort's stability.
    const first = request("first", "session-a", T0);
    const second = request("second", "session-b", T0);

    expect(longestWaiting([first, second])?.id).toBe("first");
    expect(longestWaiting([second, first])?.id).toBe("second");
  });
});

describe("a decision resolves exactly the request it was made for", () => {
  it("resolves the presented request and leaves the others pending", () => {
    const presented = request("older", "session-a", T0);
    const other = request("newer", "session-b", T0 + 500);
    const outcome = decide([presented, other], "older", "allow");

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) throw new Error("expected an applied decision");
    expect(outcome.resolved.id).toBe("older");
    expect(ids(outcome.pending)).toEqual(["newer"]);
  });

  it("carries the decision it applied", () => {
    for (const decision of ["allow", "deny"] as Decision[]) {
      const outcome = decide([request("a", "s")], "a", decision);

      expect(outcome.decision).toBe(decision);
    }
  });

  it("does not resolve a second request that happens to share the session", () => {
    // Two requests from one session: answering the older must leave the newer
    // waiting. Deciding one request is not a decision about the session.
    const older = request("req-1", "session-a", T0);
    const newer = request("req-2", "session-a", T0 + 100);
    const outcome = decide([older, newer], "req-1", "allow");

    if (!outcome.applied) throw new Error("expected an applied decision");
    expect(ids(outcome.pending)).toEqual(["req-2"]);
  });

  it("leaves the caller's set alone", () => {
    const pending = [request("a", "s")];
    decide(pending, "a", "allow");

    expect(ids(pending)).toEqual(["a"]);
  });
});

describe("a decision for a request that is gone is refused", () => {
  it("refuses rather than resolving anything", () => {
    const outcome = decide([], "stale", "allow");

    expect(outcome.applied).toBe(false);
    expect(outcome.decision).toBe("allow");
    expect(outcome.pending).toEqual([]);
  });

  it("applies nothing to whatever happens to be pending instead", () => {
    // The failure this exists to prevent: the agent moved on, a new request
    // arrives, and the stale "allow" is applied to it.
    const replacement = request("new", "session-b");
    const outcome = decide([replacement], "stale", "allow");

    expect(outcome.applied).toBe(false);
    expect(outcome.pending).toEqual([replacement]);
    expect(ids(outcome.pending)).toEqual(["new"]);
  });

  it("reports no request as refused, because none of them was the subject", () => {
    // Naming a request would invite a caller to go and look for it and find a
    // different one wearing its id.
    const outcome = decide([request("new", "s")], "stale", "allow");

    if (outcome.applied) throw new Error("expected a refusal");
    expect(outcome.refusedFor).toBeNull();
  });

  it("refuses a decision for a request that was already resolved", () => {
    const pending = [request("a", "s")];
    const first = decide(pending, "a", "allow");
    const second = decide(first.pending, "a", "deny");

    expect(second.applied).toBe(false);
    expect(second.pending).toEqual([]);
  });
});

describe("a block ending stops the request being pending", () => {
  it("drops the request for a session whose block ended", () => {
    const ended = request("req-1", "session-a");
    const other = request("req-2", "session-b");

    expect(ids(supersede([ended, other], "session-a"))).toEqual(["req-2"]);
  });

  it("makes a decision still in flight for it refused", () => {
    const inFlight = request("req-1", "session-a");
    const after = supersede([inFlight], "session-a");
    const outcome = decide(after, "req-1", "allow");

    expect(outcome.applied).toBe(false);
  });

  it("leaves other sessions' requests alone", () => {
    const a = request("req-1", "session-a");
    const b = request("req-2", "session-b");

    expect(supersede([a, b], "session-c")).toEqual([a, b]);
  });
});

describe("dismissing the surface decides nothing", () => {
  it("leaves the request pending", () => {
    const pending = [request("a", "session-a")];
    const after = dismiss(pending);

    expect(ids(after)).toEqual(["a"]);
    expect(after[0]).toBe(pending[0]);
  });

  it("still permits an answer afterwards, because nothing was consumed", () => {
    // The block is intact, so the request is still the user's to answer.
    const after = dismiss([request("a", "session-a")]);
    const outcome = decide(after, "a", "allow");

    expect(outcome.applied).toBe(true);
  });

  it("applies no default, in either direction", () => {
    const after = dismiss([request("a", "session-a")]);

    // Nothing in the model records a decision, so the only way one exists is
    // for it to have been made.
    expect(ids(after)).toEqual(["a"]);
    expect(longestWaiting(after)?.id).toBe("a");
  });
});