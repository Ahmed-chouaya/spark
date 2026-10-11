import type { AgentAdapter, CanonicalUpdate } from "./adapters/types";
import { applyEvent } from "./events";
import { createSession, type AgentId, type AgentSession } from "./session";

/**
 * Fold one canonical update into the set of live sessions.
 *
 * Sessions are keyed by `(agent, sessionId)`, so two agents can hold the same
 * session id without colliding and one agent can hold many.
 *
 * An update for a session we have never seen creates it. That is the right
 * default for a hook stream: the host telling us a session exists is how we
 * learn it exists.
 */
export function applyUpdate(
  sessions: readonly AgentSession[],
  agent: AgentId,
  update: CanonicalUpdate
): AgentSession[] {
  const index = sessions.findIndex(
    (session) => session.agent === agent && session.sessionId === update.sessionId
  );
  const existing = index >= 0 ? sessions[index] : undefined;
  if (!existing) {
    const created = createSession(agent, update.sessionId, update.event.at);
    return [...sessions, applyEvent(created, update.event)];
  }

  const updated = applyEvent(existing, update.event);
  return [...sessions.slice(0, index), updated, ...sessions.slice(index + 1)];
}

/** Translate one host payload and fold it in. Unmodelled payloads change nothing. */
export function applyPayload<P>(
  sessions: readonly AgentSession[],
  adapter: AgentAdapter<P>,
  payload: P
): readonly AgentSession[] {
  const update = adapter.translate(payload);
  return update ? applyUpdate(sessions, adapter.agent, update) : sessions;
}