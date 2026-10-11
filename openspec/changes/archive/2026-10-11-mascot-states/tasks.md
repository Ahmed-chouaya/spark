# Tasks

## 1. State lifetime classification

- [x] 1.1 Define the classification of all nine states from `mascot-rig` into transient, sustained, fault and block, and verify every state resolves to exactly one class
- [x] 1.2 Derive precedence from that classification as block > fault > transient > sustained > idle, and verify a test asserting the derived order matches an explicit expected order for every class pair

## 2. Session model

- [x] 2.1 Define the canonical session shape carrying an agent identity, a current state, and an activity timestamp, and verify it typechecks against the state names exported by `mascot-rig`
- [x] 2.2 Define the primary selection function returning the most recently active session, and verify it returns that session when several exist and nothing when none do
- [x] 2.3 Add a test covering primary selection across sessions with equal, differing and absent activity timestamps, and verify it passes

## 3. The reduction

- [x] 3.1 Implement the reduction from a set of sessions to exactly one state, in which any blocked session yields the blocked state, otherwise a fault state on the primary yields the fault state, otherwise the primary's own state is used
- [x] 3.2 Add tests covering: no sessions yielding idle; a single working session yielding working; a blocked secondary session overriding a working primary; multiple blocked sessions still yielding the blocked state; and a fault on the primary yielding the fault state
- [x] 3.3 Add a test asserting a failing background session does not affect the rendered state while an idle primary is present, and verify it passes
- [x] 3.4 Add a test asserting that after a blocked session is answered the rendered state returns to the still-primary session rather than the answered one, and verify it passes

## 4. Soft tool classification

- [x] 4.1 Define effort buckets for tool activity with a defined default bucket for unrecognised activity, and verify every bucket maps to a valid state name
- [x] 4.2 Implement the classifier so it buckets by rough effort rather than naming individual tools, and verify a code search across the module finds no per-tool mapping table
- [x] 4.3 Add a test asserting a tool the system has never seen still produces a valid state through the default bucket, and verify it passes
- [x] 4.4 Add a test asserting two different tools of broadly similar effort are permitted to yield the same state, documenting that the system does not claim to distinguish them

## 5. Event mapping

- [x] 5.1 Map session start to idle, prompt submission with no tool activity to the transient thinking state, tool activity to a sustained state via the classifier, successful completion to the transient success state, and failure to the fault state
- [x] 5.2 Map an authorisation request to the block state, and prolonged inactivity to the resting state, and verify both mappings through tests
- [x] 5.3 Add a test asserting the transient success state returns to ambient state after its display window rather than persisting, and verify it passes

## 6. Escalation rule

- [x] 6.1 Implement the rule that marks the blocked state as escalating and every other state as non-escalating, and verify a test asserting exactly one state escalates
- [x] 6.2 Implement the guard that a condition the companion cannot resolve does not escalate, and verify a test asserting an unanswerable agent question does not escalate while an authorisation request does
- [x] 6.3 Add a test asserting a fault is loud but does not escalate, and verify it passes

## 7. Adapter boundary

- [x] 7.1 Define the adapter interface translating a host agent's event payload into the canonical session shape, and verify the reduction consumes no agent-specific type
- [x] 7.2 Implement the Claude Code adapter translating its lifecycle events into the canonical shape, and verify a code search across the module finds no agent-specific branch inside the reduction
- [x] 7.3 Add a test driving the adapter with representative event sequences and asserting the resulting sessions reduce to the documented states
- [x] 7.4 Verify all nine states are reachable from the Claude Code adapter alone, and that reaching them requires no operating-system integration

## 8. Integration check

- [x] 8.1 Drive a multi-session simulation through the adapter and reduction and verify in one pass that every scenario in the spec holds, including the precedence order and the suppression of background failures
- [x] 8.2 Document the reduction, the precedence rule and the soft-classification guarantee in the module's doc comments, and verify the guarantee against false precision is stated explicitly
- [x] 8.3 Verify this change introduces no rendering dependency on `mascot-rig` beyond the exported state names, and that no window, IPC or overlay code is introduced