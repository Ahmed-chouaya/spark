# Spec Delta

## Purpose

Defines the escalation surface: what the user sees when an agent is blocked waiting on
them, when it is visible, and how that visibility adapts to what the platform can
actually keep on screen.

## ADDED Requirements

### Requirement: The blocked state is surfaced

When a session becomes blocked, the escalation surface SHALL become visible. It SHALL NOT
be visible only in the sense of being reachable — it SHALL be brought to the user.

#### Scenario: A block arrives

- **WHEN** a session becomes blocked on user input
- **THEN** the escalation surface becomes visible without the user having to look for it

#### Scenario: The surface carries the blocked state

- **WHEN** the surface is shown for a block
- **THEN** it presents the mascot in the blocked state rather than an ambient one

#### Scenario: A non-blocked change does not surface

- **WHEN** a session changes to any state other than blocked
- **THEN** the surface is not brought to the user

### Requirement: Visibility follows platform capability

The surface's behaviour when nothing is blocked SHALL depend on whether the platform can
keep a persistent surface above other windows.

- On a platform that can: the surface remains visible, presenting the ambient state.
- On a platform that cannot: the surface is not visible when nothing is actionable, and
  appears only when something is.

#### Scenario: Platform can hold a persistent surface

- **WHEN** the platform can keep the surface above other windows and no session is blocked
- **THEN** the surface remains visible in its ambient state

#### Scenario: Platform cannot hold a persistent surface

- **WHEN** the platform cannot keep the surface above other windows and no session is
  blocked
- **THEN** the surface is not visible

#### Scenario: A block on a platform without a persistent surface

- **WHEN** the platform cannot keep the surface above other windows and a session becomes
  blocked
- **THEN** the surface appears

#### Scenario: Returning to the platform's idle behaviour

- **WHEN** the block is resolved
- **THEN** the surface returns to whatever its idle behaviour is on that platform

### Requirement: An idle surface never takes focus

While the surface is showing only an ambient state, it SHALL NOT take focus from whatever
the user is working in.

#### Scenario: Ambient while the user works

- **WHEN** the surface is visible in an ambient state
- **THEN** it does not become the focused window, and a failure to do so does not raise an
  error

#### Scenario: The user is working elsewhere

- **WHEN** the user is working in another window and the surface is in an ambient state
- **THEN** their focus and their window are unaffected

### Requirement: Escalation is visually distinguishable

While the surface is escalating, it SHALL be visually distinguishable from its ambient
appearance, and the distinction SHALL NOT depend on colour alone.

#### Scenario: Escalating looks different from ambient

- **WHEN** the surface escalates
- **THEN** its appearance differs from the ambient appearance in more than hue

#### Scenario: The difference is not colour-only

- **WHEN** the surface is escalated
- **THEN** the distinction remains perceptible without distinguishing colour, since the
  surface may be seen by someone who does not perceive the colour difference

### Requirement: Escalation ends when the block ends

When no session is blocked, the surface SHALL stop escalating. Escalation SHALL NOT persist
after the condition that caused it has ended.

#### Scenario: Block resolved

- **WHEN** the pending block is resolved
- **THEN** the surface stops escalating and returns to its platform's idle behaviour

### Requirement: The surface is sized by its content

The surface SHALL size itself from its content and its own styling. A size requested of
the platform SHALL NOT be relied upon.

#### Scenario: Requested size is ignored

- **WHEN** the platform answers a size request with dimensions other than those requested
- **THEN** the surface remains correctly proportioned and fully visible

#### Scenario: Proportion holds

- **WHEN** the surface renders
- **THEN** the mascot keeps its aspect ratio and is neither clipped nor letterboxed by an
  unexpected window size

### Requirement: The surface carries the user's attention only when actionable

The surface SHALL NOT ask for attention for any condition it cannot help the user resolve.

#### Scenario: A block with no available action

- **WHEN** a session blocks on something the companion cannot resolve
- **THEN** the surface does not escalate, because calling the user to a surface with no
  action available teaches them that answering is sometimes pointless

### Requirement: Platform capability is detected rather than assumed

Whether the platform can hold a persistent surface SHALL be determined at runtime, and the
surface's behaviour SHALL follow the detected capability.

#### Scenario: Capability differs by platform

- **WHEN** the same build runs on a platform that can hold a persistent surface and on one
  that cannot
- **THEN** it produces the appropriate idle behaviour on each, without a different build