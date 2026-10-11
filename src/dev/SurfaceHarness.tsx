/**
 * The escalation surface harness.
 *
 * A page that puts the real surface on a real browser, so the things this change
 * claims about *this platform* can be checked against the compositor rather than
 * against jsdom.
 *
 * Everything it renders comes from `src/escalation` — the sessions, the fold, the
 * surface and the decision card. The page contributes controls and nothing else,
 * so what a run observes is the product's behaviour rather than a harness's
 * version of it.
 *
 * It also forces the two platform behaviours, because a machine can only
 * demonstrate one of them at a time: `?platform=persistent` and
 * `?platform=transient` are the two values the capability probe can return, and
 * this page is how the branch this machine cannot show gets looked at.
 *
 * Development-only. Nothing in `src/` imports it.
 */
import {
  useCompanionSurface,
  usePendingDecisions,
  useSessions,
  type Decision,
  type PendingRequest,
} from "../escalation";
import "../dev/dev.css";
import "./surface-harness.css";

const T0 = 1_000;
const AT = T0 + 1_000;

/** The request the harness puts in front of the user, standing in for a real one. */
const request: PendingRequest = {
  id: "req-1",
  operation: "run `npm publish`",
  sessionId: "spark",
  requestedAt: T0,
};

/**
 * Which capability to run with.
 *
 * Read from the address so a run can reach the behaviour this machine cannot
 * otherwise demonstrate. It is not a platform override in the product — the
 * product asks the compositor — it is a way to point the harness at the other
 * branch of a two-branch rule. Omitted, the page uses this machine's own answer.
 */
const forced = new URLSearchParams(window.location.search).get("platform");
const persistent = forced === "persistent" ? true : forced === "transient" ? false : undefined;

export function SurfaceHarness() {
  const { sessions, deliver } = useSessions();
  const decisions = usePendingDecisions([request]);

  const { surface, escalating, offered } = useCompanionSurface({
    sessions,
    pending: decisions.pending,
    persistent,
    onDecision: (_decision: Decision, resolved: PendingRequest) => {
      decisions.answer(_decision, resolved);
      // The agent resumes, which is what clearing the block means.
      deliver({ type: "answered", at: AT });
    },
  });

  return (
    <main>
      <h1>Escalation surface</h1>

      <div className="controls">
        <button
          type="button"
          data-testid="block"
          onClick={() => {
            // What the agent is asking for arrives alongside the block. A
            // session knows it is blocked, not what for — that half is the
            // transport's, and `agent-relay` supplies it.
            decisions.add(request);
            deliver({ type: "authorization-requested", at: T0 });
          }}
        >
          Block on an authorisation
        </button>

        <button
          type="button"
          data-testid="question"
          onClick={() => deliver({ type: "agent-question", at: T0 })}
        >
          Block on a question
        </button>
      </div>

      <p className="readout">
        Escalating: <output data-testid="escalating">{String(escalating)}</output> · pending:{" "}
        <output data-testid="pending">{String(decisions.pending.length)}</output> · offering:{" "}
        <output data-testid="offered">{offered?.id ?? "none"}</output>
      </p>

      {surface}
    </main>
  );
}