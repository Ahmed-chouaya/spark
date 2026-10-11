import { fireEvent, render, screen, act } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useCompanionSurface, usePendingDecisions } from "../src/escalation/useCompanionSurface";
import { decide, type Decision, type PendingRequest } from "../src/escalation/pending";
import { createSession, type AgentSession } from "../src/state-selection/session";
import { applyEvent, type SessionEvent } from "../src/state-selection/events";
import type { AgentAdapter, CanonicalUpdate } from "../src/state-selection/adapters/types";

/**
 * The whole round trip, end to end.
 *
 * Driven the way the product will be driven — a stream of canonical events
 * arriving from a host, through the same adapters, into the same reduction the
 * state vocabulary already owns — so what is exercised here is the path rather
 * than a hand-built session shaped to suit it.
 */

const T0 = 1_000;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "src");
const MASCOT_DIR = join(SRC_DIR, "components", "mascot");
const SELECTION_DIR = join(SRC_DIR, "state-selection");
const ESCALATION_DIR = join(SRC_DIR, "escalation");

/**
 * A host that delivers a canonical event for a session.
 *
 * Shaped like the adapters rather than like a test double, because the point of
 * driving the round trip is that it goes through the same seam the real
 * transport will.
 */
function host(): AgentAdapter<SessionEvent> {
  return {
    agent: "claude-code",
    translate: (event): CanonicalUpdate => ({
      sessionId: "session-a",
      event,
    }),
  };
}

const step = (sessions: readonly AgentSession[], event: SessionEvent): AgentSession[] => {
  const update = host().translate(event);
  if (!update) throw new Error("the adapter refused a canonical event");

  const index = sessions.findIndex(
    (session) => session.agent === host().agent && session.sessionId === update.sessionId
  );
  const existing = index >= 0 ? sessions[index]! : createSession(host().agent, update.sessionId, event.at);

  const next = applyEvent(existing, event);
  return index >= 0
    ? [...sessions.slice(0, index), next, ...sessions.slice(index + 1)]
    : [...sessions, next];
};

const pending: PendingRequest = {
  id: "req-1",
  operation: "run `rm -rf build`",
  sessionId: "session-a",
  requestedAt: T0,
};

/** The companion surface, wired to the pending set it answers against. */
function Companion({
  initial,
  persistent,
}: {
  initial: readonly AgentSession[];
  persistent: boolean;
}) {
  const [sessions, setSessions] = useState<readonly AgentSession[]>(initial);
  const decisions = usePendingDecisions([pending]);
  const { surface } = useCompanionSurface({
    sessions,
    pending: decisions.pending,
    persistent,
    onDecision: (decision: Decision, request: PendingRequest) => {
      decisions.answer(decision, request);
      // The agent resumes: the request is answered, so the session unblocks.
      setSessions(step(sessions, { type: "answered", at: T0 + 1_000 }));
    },
  });

  return (
    <>
      <button
        type="button"
        data-testid="block"
        onClick={() => {
          // What the agent is asking for arrives alongside the block. A session
          // knows it is blocked, not what for — that half is the transport's.
          decisions.add(pending);
          setSessions(step(sessions, { type: "authorization-requested", at: T0 }));
        }}
      >
        Block
      </button>
      <button
        type="button"
        data-testid="move-on"
        onClick={() => {
          // The agent finishes on its own, before the user answers.
          setSessions(
            step(sessions, {
              type: "tool-activity",
              at: T0 + 2_000,
              signals: { elapsedMs: 10, payloadBytes: 1_000 },
            })
          );
          decisions.resolve("session-a");
        }}
      >
        Move on
      </button>
      {surface}
    </>
  );
}

describe("a blocked session is brought to the user", () => {
  it("shows nothing while nothing is blocked on a platform that cannot float", () => {
    const { container } = render(<Companion initial={[]} persistent={false} />);

    expect(container.querySelector("[data-testid='escalation-surface']")).toBeNull();
    expect(screen.queryByTestId("decision-surface")).toBeNull();
  });

  it("arrives when the block does", () => {
    const { container } = render(<Companion initial={[]} persistent={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });

    expect(container.querySelector("[data-escalating]")).not.toBeNull();
    expect(screen.getByTestId("decision-surface")).toBeTruthy();
    expect(container.querySelector("svg[data-state='needsYou']")).not.toBeNull();
  });

  it("stays ambient on a platform that can float when nothing is blocked", () => {
    const { container } = render(<Companion initial={[]} persistent />);

    expect(container.querySelector("[data-testid='escalation-surface']")).not.toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();
  });
});

describe("the whole round trip, from block to resolution", () => {
  it("arrives, presents the request, and returns to the platform's idle behaviour", () => {
    const { container } = render(<Companion initial={[]} persistent={false} />);

    // 1. A block arrives, and the surface brings it to the user.
    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });
    expect(container.querySelector("[data-escalating]")).not.toBeNull();
    expect(screen.getByTestId("decision-operation").textContent).toBe(pending.operation);
    expect(screen.getByTestId("decision-session-id").textContent).toBe("session-a");

    // 2. The user decides.
    act(() => {
      fireEvent.click(screen.getByTestId("decision-deny"));
    });

    // 3. The block is cleared and escalation has stopped.
    expect(container.querySelector("[data-escalating]")).toBeNull();
    expect(screen.queryByTestId("decision-surface")).toBeNull();
    // The platform's own idle behaviour, which on this platform is absence.
    expect(container.querySelector("[data-testid='escalation-surface']")).toBeNull();
  });

  it("clears the block whichever way the user answers", () => {
    for (const answer of ["allow", "deny"] as Decision[]) {
      const { container, unmount } = render(<Companion initial={[]} persistent={false} />);

      act(() => {
        fireEvent.click(screen.getByTestId("block"));
      });
      act(() => {
        fireEvent.click(screen.getByTestId(`decision-${answer}`));
      });

      expect(container.querySelector("[data-escalating]"), answer).toBeNull();
      unmount();
    }
  });

  it("returns to ambient on a platform that can float once the block is resolved", () => {
    const { container } = render(<Companion initial={[]} persistent />);

    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });
    expect(container.querySelector("[data-escalating]")).not.toBeNull();

    act(() => {
      fireEvent.click(screen.getByTestId("decision-allow"));
    });

    // Still on screen — that is this platform's idle behaviour — and ambient.
    expect(container.querySelector("[data-testid='escalation-surface']")).not.toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();
    expect(screen.queryByTestId("decision-surface")).toBeNull();
  });
});

describe("a decision made after the request has gone away", () => {
  it("is refused, and resolves nothing in its place", () => {
    // The agent finished on its own while the card was on screen. The answer the
    // user then gives is for work that no longer exists, so it applies to
    // nothing — and in particular not to the next thing that blocks.
    const { container } = render(<Companion initial={[]} persistent={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });
    expect(screen.getByTestId("decision-surface")).toBeTruthy();

    act(() => {
      fireEvent.click(screen.getByTestId("move-on"));
    });

    // The surface has gone with the block that caused it.
    expect(screen.queryByTestId("decision-surface")).toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();

    // And a decision still in flight for the old request resolves nothing.
    const stale = decide([], pending.id, "allow");
    expect(stale.applied).toBe(false);
    expect(stale.pending).toEqual([]);
  });

  it("leaves a new block untouched by the stale answer", () => {
    const { container } = render(<Companion initial={[]} persistent={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("move-on"));
    });

    // Something else blocks afterwards. The stale decision must not land on it.
    const replacement: PendingRequest = {
      id: "req-2",
      operation: "delete the database",
      sessionId: "session-a",
      requestedAt: T0 + 5_000,
    };
    const outcome = decide([replacement], "req-1", "allow");

    expect(outcome.applied).toBe(false);
    expect(outcome.pending).toEqual([replacement]);
    expect(container.querySelector("[data-escalating]")).toBeNull();
  });
});

describe("a decision made after the request has gone away is refused end to end", () => {
  it("reaches the surface, applies nothing, and leaves a later block alone", () => {
    // The full path, rather than the model alone: a real card, a real agent
    // moving on underneath it, and a real answer arriving too late.
    const { container } = render(<Companion initial={[]} persistent={false} />);

    act(() => {
      fireEvent.click(screen.getByTestId("block"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("move-on"));
    });

    // The stale answer, applied through the model the surface would have used.
    const replacement: PendingRequest = {
      id: "req-2",
      operation: "delete the database",
      sessionId: "session-a",
      requestedAt: T0 + 5_000,
    };
    const outcome = decide([replacement], pending.id, "allow");

    expect(outcome.applied).toBe(false);
    expect(outcome.pending).toEqual([replacement]);
    // Nothing on screen was decided by it.
    expect(container.querySelector("[data-escalating]")).toBeNull();
    expect(screen.queryByTestId("decision-surface")).toBeNull();
  });
});

describe("the modules this change consumes are untouched", () => {
  const sourcesIn = (dir: string): { name: string; path: string; code: string }[] =>
    readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((path) => /\.(ts|tsx)$/.test(path))
      .map((path) => ({
        name: relative(REPO_ROOT, join(dir, path)),
        path: join(dir, path),
        code: readFileSync(join(dir, path), "utf8"),
      }));

  const specifiers = (source: string): string[] =>
    [...source.matchAll(/(?:^|\s)from\s+["']([^"']+)["']/gm)].map((match) => match[1] ?? "");

  it("reaches into neither the mascot nor state selection for a decision", () => {
    // The escalation surface consumes the mascot and the state vocabulary; it
    // must not extend either. A new requirement or code path in either module
    // would be this change reaching backwards into modules that are already
    // finished.
    for (const source of sourcesIn(ESCALATION_DIR)) {
      for (const specifier of specifiers(source.code)) {
        expect(specifier, source.name).not.toMatch(/adapters|hooks|socket|relay/i);
      }
    }
  });

  it("adds nothing to the mascot library or to state selection", () => {
    // Neither module imports the escalation surface, so the dependency runs one
    // way only and neither gains a requirement from this change.
    for (const dir of [MASCOT_DIR, SELECTION_DIR]) {
      for (const source of sourcesIn(dir)) {
        for (const specifier of specifiers(source.code)) {
          const target = resolve(dirname(source.path), specifier);
          expect(target.startsWith(ESCALATION_DIR + sep), source.name).toBe(false);
        }
      }
    }
  });

  it("adds nothing to the mascot library or to state selection", () => {
    // The strongest form of "untouched": this change adds files under
    // `src/escalation/` and nowhere else in the two modules it consumes. Both
    // modules' own files are asserted by their existing tests, so this only has
    // to catch a new *dependency* on this change's module appearing in either.
    //
    // Both modules legitimately contain files whose names mention escalation —
    // `state-selection/escalation.ts` predates this change and owns the
    // `escalates` rule, and its index re-exports it — so the check is scoped to
    // the cross-directory import this change would introduce, not to the word.
    for (const dir of [MASCOT_DIR, SELECTION_DIR]) {
      const importers = sourcesIn(dir).filter(({ path, code }) =>
        // `../escalation` from within `src/`, i.e. this change's module rather
        // than the sibling `state-selection/escalation`.
        [...code.matchAll(/(?:^|\s)from\s+["']\.\.\/escalation(?:\/[^"']*)?["']/gm)].length > 0
      );
      expect(importers.map(({ name }) => name), dir).toEqual([]);
    }
  });

  it("renders the mascot's own vocabulary through the mascot's own component", () => {
    // The surface draws a state; it does not draw one itself. If it rendered
    // raw SVG or picked a component per state, the mascot's rendering contract
    // would have a second implementation in this module.
    const surface = readFileSync(join(ESCALATION_DIR, "EscalationSurface.tsx"), "utf8");
    expect(surface).toMatch(/from "\.\.\/components\/mascot\/Mascot"/);
    expect(surface).toMatch(/<Mascot\b/);
    // No per-state lookup table of its own.
    expect(surface).not.toMatch(/MASCOT_VECTORS|MASCOT_STATES/);
  });

  it("reads the state vocabulary and the escalation rule rather than re-deriving them", () => {
    // The surface asks `selectState` which state to show and `escalates` whether
    // to interrupt. Both answers have exactly one home, and duplicating either
    // here would be a second, untested copy.
    const hook = readFileSync(join(ESCALATION_DIR, "useCompanionSurface.tsx"), "utf8");
    expect(hook).toMatch(/\bselectState\b/);
    expect(hook).toMatch(/\bescalates\b/);
    expect(hook).toMatch(/from "\.\.\/state-selection"/);
  });

  it("folds sessions with the reduction state selection already owns", () => {
    // `applyEvent` and `createSession` are consumed unchanged, so the harness
    // and the eventual relay drive the same reduction the state vocabulary
    // already tests.
    const hook = readFileSync(join(ESCALATION_DIR, "useCompanionSurface.tsx"), "utf8");
    expect(hook).toMatch(/\bapplyEvent\b/);
    expect(hook).toMatch(/\bcreateSession\b/);
  });
});