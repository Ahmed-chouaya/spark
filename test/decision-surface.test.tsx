import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DECISIONS, DecisionSurface } from "../src/escalation/DecisionSurface";
import { useCompanionSurface } from "../src/escalation/useCompanionSurface";
import type { Decision, PendingRequest } from "../src/escalation/pending";
import { escalates } from "../src/state-selection";
import { createSession, type AgentSession } from "../src/state-selection/session";

/**
 * The decision surface.
 *
 * The survey in "exactly two responses" is the important one: it walks everything
 * the surface renders that could act on the request, rather than trusting that
 * two buttons were the only controls.
 */

const T0 = 1_000;
const MODULE_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/escalation");

const request: PendingRequest = {
  id: "req-1",
  operation: "run `rm -rf build`",
  sessionId: "session-a",
  requestedAt: T0,
};

const session = (state: AgentSession["state"], block: AgentSession["block"] = null): AgentSession => ({
  ...createSession("claude-code", "session-a", T0),
  state,
  block,
});

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const moduleSources = (): { name: string; code: string }[] =>
  readdirSync(MODULE_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    // Comments stripped here, where the sources are read: every module in this
    // directory documents the rule about persistence in prose, and a guard run
    // over the prose would be failing on the explanation of the rule.
    .map((path) => ({ name: path, code: code(readFileSync(join(MODULE_DIR, path), "utf8")) }));

describe("the request is shown with enough context to decide", () => {
  it("names the operation being requested", () => {
    render(<DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("decision-operation").textContent).toBe(request.operation);
  });

  it("names the session it belongs to", () => {
    render(<DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("decision-session-id").textContent).toBe("session-a");
  });

  it("says what would happen if the user agreed, without sending them elsewhere", () => {
    const { container } = render(
      <DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />
    );

    const effects = container.querySelector("[data-testid='decision-effects']")!.textContent ?? "";
    expect(effects).toMatch(/allow/i);
    expect(effects).toMatch(/continue/i);
    // Nothing on the surface points off it — the decision has to be completable
    // here or it is a decision that often is not completed.
    expect(container.querySelector("a")).toBeNull();
  });

  it("carries the request's identity, so a decision names its own subject", () => {
    render(<DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("decision-surface").getAttribute("data-request-id")).toBe("req-1");
  });
});

describe("exactly two responses are offered", () => {
  it("offers agree and refuse", () => {
    render(<DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("decision-allow").textContent).toBe("Allow");
    expect(screen.getByTestId("decision-deny").textContent).toBe("Deny");
  });

  it("has no third option, by surveying everything actionable on the surface", () => {
    // Everything the user could act on, not just the two buttons: a third path
    // could be a link, a checkbox, or a keydown handler, and counting buttons
    // would miss all three.
    const { container } = render(
      <DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />
    );

    const actionable = [
      ...container.querySelectorAll("button, [role='button'], a, input, select, textarea"),
    ];
    const decisions = actionable
      .map((node) => node.getAttribute("data-decision"))
      .filter((value): value is string => value !== null);

    expect(decisions.sort()).toEqual(["allow", "deny"]);
    expect(decisions).toHaveLength(2);
  });

  it("offers nothing that persists beyond this request", () => {
    const { container } = render(
      <DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />
    );

    const text = (container.textContent ?? "").toLowerCase();
    // "Always allow" writes a permission into the agent's configuration: a
    // permissions-policy decision with its own blast radius, which belongs in
    // its own change rather than inside an approval card.
    for (const forbidden of ["always", "remember", "trust", "allowlist", "whitelist"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("writes no lasting permission anywhere in this module", () => {
    // The absence has to be structural: a card that offers two answers but
    // quietly persists one is worse than one that offers three.
    for (const { name, code: source } of moduleSources()) {
      for (const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "allowlist",
        "allowList",
        "permission",
        "settings",
        "config",
      ]) {
        expect(source, `${name}: ${forbidden}`).not.toMatch(new RegExp(forbidden, "i"));
      }
    }
  });

  it("labels allow as scoping to this request, not to the session", () => {
    // A label implying a broader effect would be the persistence this surface
    // refuses, whatever it is called.
    render(<DecisionSurface request={request} onDecision={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByTestId("decision-allow").textContent?.toLowerCase()).not.toContain("always");
  });
});

describe("answers are reported with the request they were made for", () => {
  it("reports the decision and the request together", () => {
    const onDecision = vi.fn();
    render(<DecisionSurface request={request} onDecision={onDecision} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByTestId("decision-allow"));

    expect(onDecision).toHaveBeenCalledWith("allow", request);
  });

  it("reports each of the two answers", () => {
    for (const { decision, label } of DECISIONS) {
      const onDecision = vi.fn();
      const { unmount } = render(
        <DecisionSurface request={request} onDecision={onDecision} onDismiss={vi.fn()} />
      );

      fireEvent.click(screen.getByTestId(`decision-${decision}`));
      expect(onDecision, label).toHaveBeenCalledWith(decision, request);
      unmount();
    }
  });

  it("treats closing as not answering", () => {
    const onDecision = vi.fn();
    const onDismiss = vi.fn();
    render(<DecisionSurface request={request} onDecision={onDecision} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByTestId("decision-dismiss"));

    expect(onDismiss).toHaveBeenCalled();
    expect(onDecision).not.toHaveBeenCalled();
  });
});

/** Mounts the whole surface so visibility and the card are read together. */
function Surface({
  sessions,
  pending,
  persistent,
  onDecision,
}: {
  sessions: readonly AgentSession[];
  pending?: readonly PendingRequest[];
  persistent: boolean;
  onDecision?: (decision: Decision, request: PendingRequest) => void;
}) {
  const { surface } = useCompanionSurface({ sessions, pending, persistent, onDecision });
  return <>{surface}</>;
}

describe("only actionable blocks present a decision surface", () => {
  it("presents one for a block the companion can resolve", () => {
    const sessions = [session("needsYou", "authorization")];

    const { container } = render(
      <Surface sessions={sessions} persistent={false} pending={[request]} />
    );

    expect(screen.getByTestId("decision-surface")).toBeTruthy();
    expect(container.querySelector("[data-escalating]")).not.toBeNull();
  });

  it("presents none for a block the companion cannot resolve", () => {
    // An agent question has no answer the companion can give, so a card for it
    // would be a card with nothing on it — and answering is sometimes pointless
    // is the lesson that costs us the one escalation we actually have.
    const unresolvable = [session("needsYou", "question")];
    expect(escalates(unresolvable[0]!)).toBe(false);

    const { container } = render(
      <Surface sessions={unresolvable} persistent={false} pending={[request]} />
    );

    expect(screen.queryByTestId("decision-surface")).toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();
    // And on a platform that can float, still nothing is escalated — the
    // ambient surface is simply not the one carrying news.
    const ambient = render(<Surface sessions={unresolvable} persistent pending={[request]} />);
    expect(ambient.container.querySelector("[data-escalating]")).toBeNull();
  });

  it("stays quiet for an unresolvable block on either platform", () => {
    const unresolvable = [session("needsYou", "question")];

    for (const persistent of [true, false]) {
      const { container, unmount } = render(
        <Surface sessions={unresolvable} persistent pending={[request]} />
      );

      expect(container.querySelector("[data-escalating]"), String(persistent)).toBeNull();
      expect(screen.queryByTestId("decision-surface"), String(persistent)).toBeNull();
      unmount();
    }
  });
});

describe("only one decision is presented at a time", () => {
  it("shows one card when two sessions are blocked", () => {
    const first: PendingRequest = { ...request, id: "req-1", sessionId: "session-a", requestedAt: T0 };
    const second: PendingRequest = { ...request, id: "req-2", sessionId: "session-b", requestedAt: T0 + 500 };

    render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[first, second]}
      />
    );

    expect(screen.getAllByTestId("decision-surface")).toHaveLength(1);
  });

  it("presents the longest-waiting of the two", () => {
    const first: PendingRequest = { ...request, id: "req-1", sessionId: "session-a", requestedAt: T0 };
    const second: PendingRequest = { ...request, id: "req-2", sessionId: "session-b", requestedAt: T0 + 500 };

    render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[second, first]}
      />
    );

    expect(screen.getByTestId("decision-surface").getAttribute("data-request-id")).toBe("req-1");
  });

  it("offers no way to reach the other pending request", () => {
    // A queue is a later change. Until then there must be no control on this
    // surface that moves to another pending request, or the "one at a time"
    // rule is only true of the initial render.
    const first: PendingRequest = { ...request, id: "req-1", requestedAt: T0 };
    const second: PendingRequest = { ...request, id: "req-2", sessionId: "session-b", requestedAt: T0 + 500 };

    const { container } = render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[first, second]}
      />
    );

    const rendered = container.textContent ?? "";
    expect(rendered).not.toContain("req-2");
    expect(rendered).not.toContain("session-b");

    for (const control of container.querySelectorAll("button, a")) {
      const label = (control.textContent ?? "").toLowerCase();
      for (const navigation of ["next", "back", "other", "more", "switch", "skip"]) {
        expect(label, navigation).not.toContain(navigation);
      }
    }
  });

  it("says nothing at all about the requests it is not showing", () => {
    const first: PendingRequest = { ...request, id: "req-1", requestedAt: T0 };
    const second: PendingRequest = {
      ...request,
      id: "req-2",
      sessionId: "session-b",
      operation: "delete the database",
      requestedAt: T0 + 500,
    };

    const { container } = render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[first, second]}
      />
    );

    expect(container.textContent).not.toContain("delete the database");
  });
});

describe("a decision clears the block and the surface returns to idle", () => {
  it("stops escalating once the request is decided", () => {
    // Resolution, as a person would do it: answer, and the surface is no longer
    // the thing that is escalating.
    const { container, rerender } = render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[request]}
      />
    );
    expect(container.querySelector("[data-escalating]")).not.toBeNull();

    rerender(
      <Surface
        sessions={[session("working")]}
        persistent={false}
        pending={[]}
      />
    );

    expect(container.querySelector("[data-escalating]")).toBeNull();
  });

  it("returns the surface to the platform's own idle behaviour", () => {
    const { container, rerender } = render(
      <Surface sessions={[session("needsYou", "authorization")]} persistent={false} pending={[request]} />
    );

    // Resolve on a platform that can float: ambient, and still on screen.
    rerender(<Surface sessions={[session("idle")]} persistent pending={[]} />);
    expect(container.querySelector("[data-testid='escalation-surface']")).not.toBeNull();
    expect(container.querySelector("[data-escalating]")).toBeNull();

    // Resolve on a platform that cannot: the surface leaves, which is that
    // platform's idle behaviour and not a failure.
    const { container: transient, rerender: rerenderTransient } = render(
      <Surface sessions={[session("needsYou", "authorization")]} persistent={false} pending={[request]} />
    );
    rerenderTransient(<Surface sessions={[session("idle")]} persistent={false} pending={[]} />);
    expect(transient.querySelector("[data-testid='escalation-surface']")).toBeNull();
  });

  it("reports the answer and the request it resolved", () => {
    const onDecision = vi.fn();
    render(
      <Surface
        sessions={[session("needsYou", "authorization")]}
        persistent={false}
        pending={[request]}
        onDecision={onDecision}
      />
    );

    fireEvent.click(screen.getByTestId("decision-deny"));

    expect(onDecision).toHaveBeenCalledWith("deny", request);
  });
});