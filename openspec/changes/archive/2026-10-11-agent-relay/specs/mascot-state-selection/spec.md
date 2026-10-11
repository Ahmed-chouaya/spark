# Spec Delta

## Purpose

Records that sessions reach the companion from a live host-agent event stream, without
changing how the companion decides which state to render.

## ADDED Requirements

### Requirement: Sessions are sourced from the host

The companion's state selection SHALL accept sessions sourced from a live host-agent event
stream. The source of sessions SHALL NOT change which state is rendered.

#### Scenario: A host stream drives the same reduction

- **WHEN** sessions arrive from a live host-agent event stream
- **THEN** the rendered state is decided by the same rules as for any other set of sessions,
  and no separate path decides it

#### Scenario: The transport holds no rules

- **WHEN** sessions reach state selection through the relay
- **THEN** the transport contributed nothing to which state was chosen beyond delivering the
  events

#### Scenario: Rules that are unchanged

- **WHEN** sessions arrive from the host, including several at once
- **THEN** the precedence, primary selection, classification and escalation rules behave
  exactly as they do for caller-supplied sessions