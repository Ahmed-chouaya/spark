# Spec Delta

## Purpose

A second host agent, end to end: which of OpenCode's events mean what, how a payload says
which agent it belongs to, and what is deliberately left unsaid.

## ADDED Requirements

### Requirement: OpenCode's events are read from OpenCode

An event emitted by OpenCode SHALL be turned into a canonical session update by the
adapter for OpenCode, and by nothing else.

#### Scenario: A tool call begins and ends

- **WHEN** OpenCode reports a tool call starting and the same call completing
- **THEN** the session shows tool activity and then returns to what it was doing

#### Scenario: The events come from the host, not from the documentation

- **WHEN** the mapping is defined
- **THEN** each event it names was observed from a running host, and an event that was not observed is not mapped

#### Scenario: The host's vocabulary is not restated

- **WHEN** the adapter and the plugin are read
- **THEN** neither reinterprets what the other means, and the reduction gains no knowledge of either host

### Requirement: A payload says which agent it belongs to

Where more than one host agent can reach the companion, the companion SHALL determine
which agent a payload belongs to from the payload itself, and SHALL NOT be told which
agent to expect.

#### Scenario: Two agents, one companion

- **WHEN** sessions arrive from two different host agents
- **THEN** both appear in the same session set, each identified by the agent that owns it

#### Scenario: A payload naming an agent it is not

- **WHEN** a payload names an agent this companion has no adapter for
- **THEN** nothing is folded in from it, and the payload is not guessed at

#### Scenario: A payload naming no agent

- **WHEN** a payload arrives with no agent to attribute it to
- **THEN** it is treated as the host this build was written for, and the sessions already here are unaffected

### Requirement: Only one state escalates across every agent

Where sessions from more than one agent are present, exactly one state SHALL escalate, and
it SHALL be decided by the same rule every agent's sessions are subject to.

#### Scenario: One agent blocked, another working

- **WHEN** a session from one agent is blocked and a session from another is working
- **THEN** the blocked one is what the companion shows, because the rule is about what is blocked rather than about who is asking

#### Scenario: The most recent agent is not the one that matters

- **WHEN** the most recently active session belongs to one agent and a session belonging to another has been blocked longer
- **THEN** the escalation is not resolved by recency alone, and the precedence rule applies as it does for one agent

### Requirement: What the companion sees is visible

The companion SHALL report which sessions it holds, which agent owns each, what state
each is in, and what any is waiting on, in a form a person can read while it runs.

#### Reporting

- **WHEN** the companion starts and as sessions arrive and change
- **THEN** it reports each session, its agent, its state, and any block, in a form that can be read without a debugger

#### Reporting: On a platform with no floating surface

- **WHEN** the platform cannot keep a surface on screen and nothing is blocked
- **THEN** the report is how a person tells a working companion from a broken one, because an empty desktop is the correct behaviour there and indistinguishable from a fault

### Requirement: No decision is answered for a host that was not measured

The companion SHALL NOT answer a permission request arriving from a host agent whose
permission interface has not been observed working.

#### Scenario: An unmeasured permission interface

- **WHEN** a host offers a way to approve or refuse a tool call that this companion has not been shown to work
- **THEN** no card is offered for it, and no decision is returned to it, because a wrong answer to a permission request is worse than no answer

#### Scenario: The reason is recorded

- **WHEN** a host's permission interface is deliberately not wired
- **THEN** the reason is written down where a reader of that host's adapter will find it
