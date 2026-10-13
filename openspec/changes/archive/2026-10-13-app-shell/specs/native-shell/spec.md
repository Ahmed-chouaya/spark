# Spec Delta

## Purpose

The host window: the native surface the companion draws on, and the platform facts it
publishes so the escalation surface can decide whether it can be ambient or must be
escalate-only.

## ADDED Requirements

### Requirement: The companion is a window

The companion SHALL present its surface on a native window it creates, rather than
printing what it decided.

#### Scenario: A session arrives and nothing is blocked

- **WHEN** a session becomes active and no session is blocked
- **THEN** the companion shows the mascot on its window rather than reporting the reduction as text

#### Scenario: The window is the product

- **WHEN** the companion starts
- **THEN** it opens exactly one window carrying the mascot and no other interface

### Requirement: The window is unadorned

The window SHALL carry no chrome the user did not ask for: no title bar, no border, no
taskbar entry, and no background behind the mascot.

#### Scenario: The mascot is the whole window

- **WHEN** the window is created
- **THEN** it has no decorations, is absent from the taskbar, and is transparent outside the mascot's own bounds

#### Scenario: Nothing to click that is not the mascot

- **WHEN** the user looks at the window
- **THEN** the only visible content is the mascot and, when a block is actionable, the decision card

### Requirement: The window is never resized to a request

The host SHALL NOT treat any size it asks for as a size it will get, and SHALL NOT correct
a window that came back a different size.

#### Scenario: The platform answers with different dimensions

- **WHEN** the host requests one size and the platform creates the window at another
- **THEN** the host leaves it, and the mascot stays correctly proportioned and fully visible

#### Scenario: The size was measured and still did not hold

- **THEN** the host takes no action in response, because resizing to correct a viewport is how a mascot ends up cropped or letterboxed

### Requirement: The platform's answer is published, not assumed

The host SHALL publish which protocols the platform granted the window's surface, at the
seam `src/escalation/capability.ts` reads, and that published list SHALL be what the
escalation surface decides from.

#### Scenario: The compositor granted the layer protocol

- **WHEN** the host's window was created with a layer granted
- **THEN** the published report includes it, and the surface behaves as one that can stay on top

#### Scenario: The compositor granted no layer

- **WHEN** the host's window was created without one
- **THEN** the published report does not include it, and the surface is absent until something is blocked

#### Scenario: Nothing published at all

- **WHEN** no host report exists
- **THEN** the surface reads that as "cannot hold a persistent surface", because that answer is correct on every platform and the opposite is correct on none

#### Scenario: The host is not the only thing that could answer

- **WHEN** a report exists but does not name the protocol that decides the question
- **THEN** the surface still reports that it cannot hold a persistent surface

### Requirement: An ambient window never takes focus

While the window is showing only an ambient state, the host SHALL NOT bring the window to
the front, and a platform that refuses the request SHALL NOT raise an error.

#### Scenario: The user is working elsewhere

- **WHEN** the window is showing an ambient state and the user types in another application
- **THEN** their focus and their keystrokes stay where they put them

#### Scenario: The window appears without being asked to

- **WHEN** the window is created
- **THEN** it is not the focused window, and a failure to prevent that is reported rather than raised

#### Scenario: Taking focus is allowed when it is needed

- **WHEN** the window is showing a decision the user has to act on
- **THEN** bringing it forward is permitted, because a card the user cannot reach is not an offer

### Requirement: The window is shown only when the rule says so

The host SHALL show and hide the window according to the visibility rule the escalation
surface already implements, rather than holding its own opinion about when to be visible.

#### Scenario: A block arrives on a platform that cannot float

- **WHEN** no session is blocked and a session becomes blocked
- **THEN** the window appears

#### Scenario: The block is resolved

- **WHEN** the blocked session is no longer blocked
- **THEN** the window returns to whatever the platform's idle behaviour is

#### Scenario: One place decides visibility

- **WHEN** the host needs to know whether to show the window
- **THEN** it asks the visibility rule rather than re-deriving the conditions

### Requirement: The window is placed rather than left where it lands

The host SHALL position the window so it is visible on the screen, and SHALL verify the
position took effect rather than assuming a successful call moved it.

#### Scenario: A platform that ignores the request

- **WHEN** the host asks for a position and the window does not move
- **THEN** the host reports that the surface cannot be placed, rather than leaving a mascot in a corner and calling it working

#### Scenario: No display bounds known

- **WHEN** the host cannot determine the work area
- **THEN** it places the window at a documented default and says so, rather than failing to start

### Requirement: The window does not outlive its usefulness

The companion SHALL close rather than leave a surface behind when it is asked to stop, and
SHALL release the channel on the way out.

#### Scenario: Stopping cleanly

- **WHEN** the companion is asked to stop
- **THEN** the window closes and the channel is released, so a later start is not blocked by this one

#### Scenario: The window is closed by the user

- **WHEN** the window is closed
- **THEN** the companion stops, because a companion with no window cannot do the one thing it is for
