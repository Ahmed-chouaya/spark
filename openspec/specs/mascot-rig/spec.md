# mascot-rig Specification

## Purpose
Defines the mascot's public state vocabulary and the rendering contract that keeps every
state registered against the others, so the character reads as one continuous presence
rather than a set of separate drawings.

## Requirements

### Requirement: Mascot state vocabulary

The mascot SHALL accept exactly nine named states. Each name SHALL denote one distinct
condition. The vocabulary SHALL include exactly one state denoting an agent that has
stopped and is waiting on the user for input, and it SHALL NOT name any state after a
condition its appearance contradicts.

#### Scenario: Every state renders

- **WHEN** the mascot is rendered once for each of its nine states
- **THEN** each state produces a visible character and none produces an empty or broken result

#### Scenario: Blocked-on-user state exists

- **WHEN** the state vocabulary is enumerated
- **THEN** exactly one state denotes an agent stopped and awaiting user input

#### Scenario: Names agree with appearance

- **WHEN** each state's name is compared against the expression its artwork presents
- **THEN** no state's name describes an emotion or condition its artwork visibly contradicts

### Requirement: Scale is invariant across states

Applying the same nominal width to any two states SHALL render the character at the same
apparent scale. Changing state SHALL NOT visibly resize the character.

Body geometry MAY vary between states — the character drawn shorter in one state than
another is accepted, and SHALL be read as squash-and-stretch against a fixed floor rather
than as a scaling change. This variation is bounded and SHALL NOT exceed the bounds
recorded in the design.

#### Scenario: Switching between the most divergent states

- **WHEN** the mascot is rendered at a fixed width in the state with the shortest body and
  again in the state with the tallest
- **THEN** the character's overall height occupies the same proportion of the rendered box
  in both, and the change of state is not perceptible as a resize

#### Scenario: Body shape variation is not a scale change

- **WHEN** a state whose body is drawn shorter than its neighbours is rendered
- **THEN** the character's body appears compressed against a fixed floor line rather than
  the whole character shrinking

### Requirement: Face registration is invariant

Across all states, the character's face SHALL land at the same horizontal position within
the canvas. The floor shadow MAY drift horizontally between states.

#### Scenario: State with the most extreme body offset

- **WHEN** a state whose body sits furthest from its own floor bar is rendered
- **THEN** the face centre still lands within the stated tolerance of the canonical
  horizontal anchor

#### Scenario: Floor drift is permitted but face drift is not

- **WHEN** two states are overlaid and compared
- **THEN** the faces coincide within tolerance, and any horizontal difference in the floor
  bars does not displace either face

### Requirement: Vertical placement is invariant

Across all states, the floor line SHALL land at the same vertical position within the
canvas, so the character appears planted rather than floating.

#### Scenario: All states share a floor

- **WHEN** every state is rendered and the floor line of each is measured
- **THEN** all floor lines fall within the stated tolerance of the canonical floor

### Requirement: Content is contained

All content of every state SHALL render within the declared canvas without clipping.

#### Scenario: State with the tallest content

- **WHEN** the state whose artwork extends furthest above the floor line is rendered
- **THEN** its full artwork is visible with no clipping, and it still clears the canvas edge

#### Scenario: A future re-export grows a state

- **WHEN** newly exported artwork for any state extends beyond the canvas bounds
- **THEN** the build fails rather than silently clipping the artwork

### Requirement: Instances are independently addressable

Runtime code SHALL be able to address the animatable parts of one mascot instance without
affecting any other mascot instance rendered in the same document, including instances of
the same state.

#### Scenario: Two mascots of the same state

- **WHEN** two mascots of the same state are rendered simultaneously and the parts of the
  first are modified
- **THEN** the second mascot is visually unchanged

#### Scenario: Parts are individually reachable

- **WHEN** runtime code addresses the body, eyes and accessory parts of a mascot
- **THEN** it resolves that mascot's own parts, and each part can be addressed and modified
  independently of the others

### Requirement: Rendering is independent of surrounding mascots

A mascot SHALL render its correct colours and appearance regardless of how many other
mascots are present in the same document, in any state.

#### Scenario: Full set rendered together

- **WHEN** all nine states are rendered simultaneously in one document
- **THEN** each renders its own intended colours and appearance, with none inheriting
  another's

### Requirement: Canvas cannot be overridden by callers

The mascot's rendering contract SHALL NOT be alterable through props accepted from a
caller. In particular a caller-supplied canvas declaration SHALL NOT take effect.

#### Scenario: Caller passes a canvas declaration

- **WHEN** a caller supplies a canvas declaration alongside a state
- **THEN** the mascot renders on its own canonical canvas and the supplied value has no
  effect

### Requirement: Default rendering size

Rendered without explicit sizing, the mascot SHALL occupy a defined default box whose
height follows from its declared canvas aspect ratio.

#### Scenario: No sizing props supplied

- **WHEN** the mascot is rendered with a state and no size props
- **THEN** it occupies the default width and a height matching the canvas aspect ratio

### Requirement: Accessible naming

The mascot SHALL expose an accessible name that reflects its currently active state.

#### Scenario: Each state is announced distinctly

- **WHEN** each state in turn is rendered as a standalone image
- **THEN** the accessible name differs between states and identifies the active one

#### Scenario: Caller supplies a name

- **WHEN** a caller supplies their own accessible name
- **THEN** the caller's value is used instead of the state-derived default
