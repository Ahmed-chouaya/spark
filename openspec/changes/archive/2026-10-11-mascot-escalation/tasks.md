# Tasks

## 1. Platform capability

- [x] 1.1 Determine at runtime whether the platform can keep a window above other windows that are not focused, and verify the detection reports the expected result on this machine
- [x] 1.2 Add a test covering both capability results, verifying the same build yields each behaviour without a compile-time platform switch
- [x] 1.3 Document in the detection module why layer-shell is the deciding factor and what the probe actually measures, and verify the note names the protocol rather than the OS

## 2. Escalation surface

- [x] 2.1 Render the escalation surface presenting the mascot in the state `selectState` produces, and verify a blocked selection presents the blocked state
- [x] 2.2 Make the surface appear when a block arrives and stop escalating when the block ends, and verify both transitions with tests covering arrival and resolution
- [x] 2.3 Implement the platform-conditional idle behaviour: visible and ambient where the platform can hold a persistent surface, absent where it cannot, and verify both against the spec's scenarios
- [x] 2.4 Ensure the ambient surface never takes focus on any platform, and verify a platform that cannot comply produces no error and simply does not take focus
- [x] 2.5 Make escalation distinguishable by motion and scale as well as colour, and verify the change is observable when colour is not perceivable
- [x] 2.6 Size the surface from its own content and styling rather than a requested window size, and verify it stays proportioned and unclipped when the platform answers with different dimensions than requested

## 3. Pending decision model

- [x] 3.1 Define the pending request carrying the operation, the session it belongs to, and an identity that survives until it is resolved or superseded
- [x] 3.2 Offer the longest-waiting pending request when more than one is blocked, and verify both a two-block case and a single-block case
- [x] 3.3 Ensure only one decision is presented at a time with no way to switch between them, and verify no second request is reachable from the presenting surface
- [x] 3.4 Refuse a decision made for a request that is no longer pending, and verify the refusal applies nothing rather than falling through to whatever is pending
- [x] 3.5 Ensure a decision resolves exactly the request it was made for and no other, and verify with two pending requests that only the presented one resolves
- [x] 3.6 Leave the block intact when the surface is dismissed without a decision, and verify no timeout applies and nothing is decided

## 4. Decision surface

- [x] 4.1 Present the pending operation and the session or project it belongs to, with enough detail to decide it without leaving the surface
- [x] 4.2 Offer exactly two responses and no others, and verify a survey of the surface finds no third option and nothing that writes a lasting permission
- [x] 4.3 Present no decision surface for a block the companion cannot resolve, and verify the surface escalates for an actionable block and stays quiet for an unresolvable one
- [x] 4.4 On a decision, stop escalating and resume the platform's normal idle behaviour, and verify the block is cleared and the surface returns

## 5. Integration check

- [x] 5.1 Run the full suite and verify the mascot and state-selection tests pass unchanged, with no requirement or code path added to either module
- [x] 5.2 Add a test driving a blocked session through arrival, decision and resolution against the real surface, and verify the whole round trip end to end
- [x] 5.3 Add a test asserting a decision made after the request has gone away is refused, and verify nothing else is resolved in its place
- [x] 5.4 Verify on this machine that the surface does not take focus while ambient, and document the observed behaviour for the persistent-surface path once that path is run on a platform supporting it