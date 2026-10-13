# Spec Delta

## MODIFIED Requirements

### Requirement: Sessions are sourced from the host

The companion's state selection SHALL accept sessions sourced from a live host-agent event
stream, from more than one host agent at once. The source of sessions SHALL NOT change which
state is rendered, and which agent a session came from SHALL NOT change the rules applied
to it.

#### Scenario: A host stream drives the same reduction

- **WHEN** sessions arrive from a live host-agent event stream
- **THEN** the rendered state is decided by the same rules as for any other set of sessions,
  and no separate path decides it

#### Scenario: More than one host at once

- **WHEN** sessions arrive from two host agents
- **THEN** they are reduced by the same rules as one agent's sessions, and no rule exists that
  applies to one agent's sessions and not another's

#### Scenario: The agent a session came from is not a rule

- **WHEN** two sessions are compared
- **THEN** the agent each came from is a fact about the session rather than an input to the rules,
  so precedence, ordering and escalation do not vary by which agent a session belongs to
