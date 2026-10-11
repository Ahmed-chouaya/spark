# mascot-state-selection Specification

## Purpose
Defines which state the mascot shows at any moment, given a set of live agent sessions —
the precedence rules, the choice of which session is represented, and the mapping from
agent activity onto the state vocabulary.

## Requirements

### Requirement: Exactly one state is rendered

The companion SHALL render exactly one state at any moment, regardless of how many agent
sessions are live.

#### Scenario: Multiple sessions are live

- **WHEN** three sessions are live in different states
- **THEN** the companion renders one single state, and no per-session representation is shown

#### Scenario: No session is live

- **WHEN** no agent session is live
- **THEN** the companion renders the idle state

### Requirement: Blocked sessions take precedence

When any live session is waiting on the user, the rendered state SHALL be the state
denoting a blocked agent, regardless of the state of the primary session.

#### Scenario: Primary is working while another session is blocked

- **WHEN** the primary session is working and a second session is blocked on the user
- **THEN** the companion renders the blocked state

#### Scenario: All sessions are blocked

- **WHEN** every live session is blocked
- **THEN** the companion renders the blocked state

### Requirement: Only the primary session drives ambient state

When no session is blocked, the rendered state SHALL be the state of the primary session.
A non-primary session SHALL NOT influence the rendered state.

#### Scenario: Background session is busy

- **WHEN** the primary session is idle and a background session is working
- **THEN** the companion renders the primary session's idle state, not the background
  session's working state

#### Scenario: Background session fails

- **WHEN** the primary session is idle and a background session fails
- **THEN** the companion renders the primary session's idle state, and the background
  failure is not surfaced through the companion

#### Scenario: The sacrifice is deliberate

- **WHEN** the rule that background failures are not surfaced is applied
- **THEN** it is accepted that a failing background session is not noticed through the
  companion, because a failure the user is not present for is already finished news

### Requirement: The primary is the most recently active session

The primary session SHALL be the session that most recently became active. Becoming active
SHALL be defined as the user submitting work to that session.

#### Scenario: User switches sessions

- **WHEN** the user submits a prompt to session B while session A was previously primary
- **THEN** session B becomes primary

#### Scenario: A blocked session later unblocks

- **WHEN** a blocked session is answered and the companion returns to ambient state
- **THEN** the companion renders the state of the session that is still primary, which is
  not necessarily the session just answered

### Requirement: Exactly one state escalates

Exactly one state SHALL escalate, and it SHALL be the state denoting a blocked agent. The
fault state SHALL be loud without escalating.

#### Scenario: Blocked state escalates

- **WHEN** a session becomes blocked
- **THEN** the companion escalates so the user is brought to it

#### Scenario: Fault state does not escalate

- **WHEN** a session fails
- **THEN** the companion is loud about it but does not escalate, because the session has
  already ended and there is no decision for the user to make

### Requirement: Unresolvable states do not escalate

A state the companion cannot act on SHALL NOT escalate. If the user cannot complete the
pending action from the companion, the condition SHALL NOT be escalated.

#### Scenario: Agent asks a question the companion cannot answer

- **WHEN** an agent session blocks on a question the companion has no way to answer
- **THEN** the companion does not escalate, because escalating to a card with no available
  action is worse than remaining quiet

### Requirement: States are classified by lifetime

Every state SHALL be classified as transient, sustained, fault or block. Classification
SHALL determine whether a state returns on its own, and SHALL order precedence between
states.

#### Scenario: Transient state expires

- **WHEN** a transient state is entered and no further activity occurs
- **THEN** the companion returns to the state it held before the transient state

#### Scenario: Sustained state holds

- **WHEN** a sustained state is entered and no further activity occurs
- **THEN** the companion holds that state rather than reverting

#### Scenario: Precedence follows classification

- **WHEN** two states could apply at once
- **THEN** the block state wins over the fault state, which wins over a transient state,
  which wins over a sustained state, which wins over idle

### Requirement: Agent events map to states

Agent lifecycle events SHALL map to the documented states. A prompt with no tool activity
yet SHALL map to a transient state; ordinary tool activity SHALL map to sustained states
chosen by rough effort; completion SHALL map to a transient state; failure SHALL map to
the fault state; a request for user authorisation SHALL map to the block state; and
prolonged inactivity SHALL map to the sustained resting state.

#### Scenario: Session starts

- **WHEN** a session starts with no activity
- **THEN** the companion renders the idle state

#### Scenario: Work begins but no tool has run

- **WHEN** the user submits work and no tool has been invoked yet
- **THEN** the companion renders the transient thinking state

#### Scenario: Tool activity occurs

- **WHEN** a tool is invoked
- **THEN** the companion renders a sustained working state reflecting rough effort rather
  than the specific tool

#### Scenario: Work completes successfully

- **WHEN** a session completes successfully
- **THEN** the companion renders the transient success state before returning to ambient

#### Scenario: Work fails

- **WHEN** a session ends in failure
- **THEN** the companion renders the fault state

#### Scenario: Authorisation is requested

- **WHEN** a session requests authorisation from the user
- **THEN** the companion renders the block state

#### Scenario: Nothing happens for a prolonged period

- **WHEN** no activity occurs for a prolonged period
- **THEN** the companion renders the resting state

### Requirement: Tool classification is soft

Tool activity SHALL be classified into broad buckets by rough effort, with a defined
default bucket for anything unrecognised. The system SHALL NOT assert a specific resulting
state for each individual tool.

#### Scenario: Unrecognised tool

- **WHEN** a tool the system has never seen is invoked
- **THEN** the companion still renders a valid state, using the default bucket, and the
  absence of a specific mapping does not prevent a state being produced

#### Scenario: Host agent adds a tool

- **WHEN** the host agent gains a new tool after the companion is built
- **THEN** no change to the companion is required for that tool to be handled, and no
  mapping decision is demanded

### Requirement: Classification does not assert false precision

Where the resulting state reflects a judgement rather than a fact, the system SHALL NOT
claim the mapping is exact.

#### Scenario: Two tools of similar effort

- **WHEN** two different tools of broadly similar effort are invoked
- **THEN** they MAY render the same state, and the system does not claim to distinguish
  them

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
