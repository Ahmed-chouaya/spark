# Spec Delta

## Purpose

Defines the approval round trip: presenting a pending agent request with enough context to
decide it, capturing the user's decision, and applying that decision to exactly the request
it was made for.

## ADDED Requirements

### Requirement: The pending request is shown with enough context to decide

When a decision surface is opened for a blocked session, it SHALL identify what is being
asked for, in terms specific enough to decide it without leaving the surface.

#### Scenario: The request is identifiable

- **WHEN** a decision surface is opened
- **THEN** it names the operation being requested and the session or project it belongs to

#### Scenario: Enough to decide

- **WHEN** a decision surface is shown
- **THEN** the user can determine what would happen if they agreed, without consulting
  another window

### Requirement: Exactly two decisions are offered

The decision surface SHALL offer exactly two ways to respond: agree, and refuse. It SHALL
NOT offer any option that persists the decision beyond the request it was made for.

#### Scenario: The offered choices

- **WHEN** a decision surface is shown
- **THEN** exactly two responses are available

#### Scenario: No persistent option

- **WHEN** a decision surface is shown
- **THEN** no offered response writes a lasting permission or policy, because that is a
  separate decision deserving its own review

### Requirement: A decision applies only to the request it was made for

A decision SHALL be applied only to the pending request that was presented when the
decision was made. A decision offered for a request that is no longer pending SHALL be
refused rather than applied to whatever is pending now.

#### Scenario: Request already resolved elsewhere

- **WHEN** a decision is made for a request that is no longer pending
- **THEN** the decision is refused and nothing else is decided in its place

#### Scenario: The agent moved on

- **WHEN** the agent has moved past the request before the user decided
- **THEN** the decision does not apply to the agent's later work

#### Scenario: Resolving exactly one request

- **WHEN** a decision is applied
- **THEN** it resolves the one request it was made for and no other

### Requirement: Only actionable blocks present a decision surface

A decision surface SHALL be presented only for a block the companion can resolve.

#### Scenario: A block the companion can resolve

- **WHEN** a session blocks in a way the companion can resolve
- **THEN** a decision surface can be presented

#### Scenario: A block the companion cannot resolve

- **WHEN** a session blocks in a way the companion cannot resolve
- **THEN** no decision surface is presented

### Requirement: More than one blocked session presents the longest-waiting

Where more than one session is blocked, the surface SHALL present the request that has been
waiting longest, and SHALL NOT present the others simultaneously.

#### Scenario: Two sessions blocked

- **WHEN** two sessions are blocked and only one has been blocked longer
- **THEN** that one is presented

#### Scenario: The others are not shown

- **WHEN** a decision surface is showing one blocked session
- **THEN** no second decision surface is shown for another blocked session at the same time

#### Scenario: No queue to navigate

- **WHEN** one blocked session's decision surface is showing
- **THEN** the surface offers no way to switch to another pending request

### Requirement: A decision resolves the block

Once a decision is applied, the session SHALL stop being blocked and the companion SHALL
return to its normal behaviour.

#### Scenario: Session resumes

- **WHEN** a decision is applied for a blocked session
- **THEN** that session is no longer blocked

#### Scenario: Companion returns to normal

- **WHEN** a decision has been applied
- **THEN** the companion stops escalating and resumes whatever behaviour the absence of a
  block implies

### Requirement: Abandoning a decision surface changes nothing

If a decision surface is dismissed without a decision, the block SHALL remain pending and
nothing SHALL have been decided.

#### Scenario: Dismissed without deciding

- **WHEN** a decision surface is closed without a decision being made
- **THEN** the session is still blocked and no decision has been recorded