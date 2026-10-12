# Spec Delta

## MODIFIED Requirements


### Requirement: The blocked state is surfaced

When a session becomes blocked, the escalation surface SHALL become visible. It SHALL NOT
be visible only in the sense of being reachable — it SHALL be brought to the user.

The visibility SHALL be of the window itself: presenting the surface within a window that
is not on screen does not satisfy this, and a host that cannot place or raise its window
SHALL report that rather than presenting the surface into a window the user cannot see.

#### Scenario: A block arrives

- **WHEN** a session becomes blocked on user input
- **THEN** the escalation surface becomes visible without the user having to look for it

#### Scenario: The surface carries the blocked state

- **WHEN** the surface is shown for a block
- **THEN** it presents the mascot in the blocked state rather than an ambient one

#### Scenario: A non-blocked change does not surface

- **WHEN** a session changes to any state other than blocked
- **THEN** the surface is not brought to the user

#### Scenario: The window could not be raised

- **WHEN** a block arrives and the host's window cannot be shown above other windows
- **THEN** the host says the surface could not be raised, because a companion that looks present and is not is worse than one that is honestly absent
