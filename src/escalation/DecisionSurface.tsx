import type { Decision, PendingRequest } from "./pending";

/**
 * The decision surface: one pending request, two answers.
 *
 * Three rules, and each one is a requirement rather than a style choice.
 *
 * **Enough to decide, on this surface.** The user can be here and decide it, or
 * they cannot decide it at all. So it names the operation and the session it
 * belongs to, and never sends them somewhere else to find out what approving
 * would mean.
 *
 * **Exactly two answers.** Allow and deny. Not "always allow": writing a
 * permission into the agent's configuration is a permissions-policy decision
 * with its own blast radius — it changes what a *future* session may do without
 * asking, and it edits user configuration — and that deserves its own change,
 * its own review and its own undo. Hiding one inside an approval card is how a
 * policy decision ships unreviewed. Two answers, both of which apply to this
 * request and stop there.
 *
 * **One at a time.** There is no queue and no way to move between pending
 * requests, deliberately: see `longestWaiting`. The surface offers the request
 * that has been waiting longest and says nothing about the others, so there is
 * nothing on screen to switch to.
 */
export interface DecisionSurfaceProps {
  /** The request being offered. Exactly one, always. */
  readonly request: PendingRequest;
  /** Called with the user's answer and the request it was made for. */
  readonly onDecision: (decision: Decision, request: PendingRequest) => void;
  /** Called when the surface is closed without an answer. */
  readonly onDismiss: () => void;
}

/**
 * The two responses, in that order.
 *
 * A closed list rather than two literals in the markup, so "exactly two" is a
 * property the component cannot drift from, and so a test can check the
 * rendered buttons against the same list the component renders from.
 *
 * The allow label says what it does to *this request*, because that is the
 * scope of the decision and a label implying a broader one would be the very
 * persistence this surface refuses to offer.
 */
export const DECISIONS: readonly { readonly decision: Decision; readonly label: string }[] = [
  { decision: "allow", label: "Allow" },
  { decision: "deny", label: "Deny" },
];

export function DecisionSurface({ request, onDecision, onDismiss }: DecisionSurfaceProps) {
  return (
    <section
      data-testid="decision-surface"
      data-request-id={request.id}
      role="dialog"
      aria-label="Agent request"
    >
      <h2 data-testid="decision-operation">{request.operation}</h2>

      <p data-testid="decision-session">
        <span data-testid="decision-session-id">{request.sessionId}</span>
      </p>

      {/*
        Everything needed to decide is on this surface: what is asked, which
        session asks it, and what each answer does. Nothing here is a link out,
        because a decision the user has to leave to complete is a decision that
        often is not completed.
      */}
      <ul data-testid="decision-effects">
        <li>Allowing lets this agent continue with that request.</li>
        <li>Denying stops it.</li>
        {/* Stated on the surface because the absence is the point: neither
            answer reaches past this request. */}
        <li>Neither answer applies to any later request.</li>
      </ul>

      <div data-testid="decision-actions">
        {DECISIONS.map(({ decision, label }) => (
          <button
            key={decision}
            type="button"
            data-testid={`decision-${decision}`}
            data-decision={decision}
            onClick={() => onDecision(decision, request)}
          >
            {label}
          </button>
        ))}

        {/* Closing is not answering. It resolves nothing, applies nothing, and
            defaults nothing — see `dismiss` in ./pending. */}
        <button type="button" data-testid="decision-dismiss" onClick={onDismiss}>
          Close
        </button>
      </div>
    </section>
  );
}