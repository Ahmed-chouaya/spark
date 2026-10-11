import type { SessionEvent } from "../events";
import type { AgentId } from "../session";

/**
 * What an adapter hands back: the canonical session shape, addressed.
 *
 * The session identity travels with the event rather than inside it, because
 * the host is the only party that knows which of its own sessions a payload
 * concerns. Everything after this point is agent-agnostic.
 */
export interface CanonicalUpdate {
  /** The session, within the adapter's agent, this payload concerns. */
  readonly sessionId: string;
  /** The canonical event it represents. */
  readonly event: SessionEvent;
}

/**
 * Translates one host agent's payloads into canonical session updates.
 *
 * This is the seam that lets a second agent be added later as another adapter
 * rather than as another branch in the reduction. The reduction consumes
 * `AgentSession` and never sees a host payload, so the cost of supporting a new
 * agent is one file in this directory and nothing anywhere else.
 *
 * Returning `null` means "nothing to say" — an event this adapter does not
 * model. Hosts emit more than we care about, and the correct reading of an event
 * we do not model is silence, not a guess.
 */
export interface AgentAdapter<P = unknown> {
  /** Identifies the host agent, and namespaces its session ids. */
  readonly agent: AgentId;
  translate(payload: P): CanonicalUpdate | null;
}