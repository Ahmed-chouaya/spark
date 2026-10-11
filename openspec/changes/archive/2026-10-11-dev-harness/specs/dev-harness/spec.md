# Spec Delta

## Purpose

Gives the mascot a development-time surface where its full state vocabulary can be seen
and driven, so visual questions about the character can be answered without shipping an
application.

## ADDED Requirements

### Requirement: Every state is rendered

The development page SHALL render every state in the mascot's vocabulary at the same time,
so that all of them can be compared in one view.

#### Scenario: Full vocabulary on screen

- **WHEN** the development page is opened
- **THEN** every state the mascot defines appears on screen, each labelled with its name

#### Scenario: A state is added later

- **WHEN** a state is added to the mascot's vocabulary
- **THEN** it appears on the development page without the page being hand-edited

#### Scenario: Comparison is meaningful

- **WHEN** the rendered states are compared
- **THEN** they share one canvas size and one baseline, so a difference in apparent scale
  is a defect rather than an artefact of layout

### Requirement: A single state can be shown

The page SHALL accept a request for one specific state and render it on its own, without
the others.

#### Scenario: Requested state is honoured

- **WHEN** the page is opened requesting one state
- **THEN** only that state is rendered, and it is the state requested

#### Scenario: Unknown state requested

- **WHEN** the page is opened requesting a state that does not exist
- **THEN** the page renders without failing, showing a default state, and the failure does
  not surface as a blank page or an unhandled error

### Requirement: States are selectable by an operator

A developer SHALL be able to change the displayed state without editing source and
reloading by hand.

#### Scenario: Selection changes what is shown

- **WHEN** a different state is selected
- **THEN** the page renders that state, and the selection is reflected in what the page
  reports as its current state

#### Scenario: Every state is reachable

- **WHEN** the selection controls are inspected
- **THEN** each state in the vocabulary can be selected

### Requirement: Size can be varied

The page SHALL allow the rendered character to be shown at several sizes, including a
small size, so that legibility at small scale can be checked.

#### Scenario: Small and large renderings available

- **WHEN** sizes are varied
- **THEN** the character renders at a small size and at a large size from the same state

#### Scenario: Default size is sensible

- **WHEN** no size is requested
- **THEN** the character renders at a size appropriate for inspecting it

### Requirement: The surface is development-only

The surface SHALL exist only for development, and SHALL NOT be part of the shipped
application.

#### Scenario: Nothing to ship

- **WHEN** the project's production artifacts are assembled
- **THEN** no part of the development page or its entry point is included

#### Scenario: No production dependency

- **WHEN** the application is built
- **THEN** building it does not require the development surface to be present

### Requirement: The surface does not alter the mascot

The surface SHALL observe the mascot's rendering contract without changing it, and SHALL
NOT modify the behaviour of the mascot or of state selection.

#### Scenario: Library is unchanged by the harness

- **WHEN** the mascot's own tests and the state-selection tests are run
- **THEN** they pass exactly as they did before the development surface existed

#### Scenario: No state-selection coupling

- **WHEN** a state is shown on the development page
- **THEN** the state was supplied to the page rather than derived by it, and the page holds
  no state-selection logic of its own

### Requirement: Starting the surface is one command

A developer SHALL be able to start the development surface with a single documented command.

#### Scenario: One command starts it

- **WHEN** the documented command is run in a clean checkout
- **THEN** the surface is served and can be opened in a browser, with no further setup
  beyond installing dependencies

#### Scenario: The address is predictable

- **WHEN** the surface is started
- **THEN** it is served at a fixed, documented address, so an automated run can reach it
  without being told where to look