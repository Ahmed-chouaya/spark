# Tasks

## 1. The adapter

- [ ] 1.1 Write `src/state-selection/adapters/opencode.ts` from the **measured** event shapes, and verify each mapped event produces the canonical event named in the design
- [ ] 1.2 Join a tool call's start to its end by the host's own call id, and verify the pair yields one activity with an elapsed time rather than two unrelated ones
- [ ] 1.3 Carry effort signals out of the same place the Claude Code adapter does, so classification needs no change and no new test
- [ ] 1.4 Map a turn's end to `completed` or `failed` by the host's own `finish`, and verify each
- [ ] 1.5 Deliberately not map `permission.asked`, and verify it produces no escalation and no card — a loud state with nothing to act on is worse than silence
- [ ] 1.6 Deliberately not map the per-token streams, and verify they produce nothing
- [ ] 1.7 Verify every event in the fixtures came from a running host, and that an event never observed is not mapped

## 2. Which agent a payload belongs to

- [ ] 2.1 Introduce the `{ agent, event }` envelope, with a payload carrying no envelope treated as the agent this build was written for
- [ ] 2.2 Resolve the adapter from the envelope in the shell, so the shell stops hardcoding one
- [ ] 2.3 Verify a payload naming an agent with no adapter is dropped rather than guessed at, and that the sessions already held are unaffected
- [ ] 2.4 Verify sessions from two agents land in one session set with the reduction untouched
- [ ] 2.5 Prove the reduction gained no knowledge of either host: a structural guard over `src/state-selection` naming no host event from either

## 3. The plugin

- [ ] 3.1 Write the OpenCode plugin forwarding its own event stream, translating nothing: the payload is OpenCode's shape and only the adapter knows what it means
- [ ] 3.2 Make it a dumb pipe by construction, and add a structural test that fails if it names a canonical event, a mascot state, or a session field
- [ ] 3.3 Verify a plugin failure changes nothing for the user: no exception reaches the host, and the host is not made to wait

## 4. Seeing it work

- [ ] 4.1 Report every session on standard error — agent, id, state, and what it is waiting on — and verify `npm run companion` shows it with nothing new to configure
- [ ] 4.2 Report a session the moment it appears and every time its state changes, so a live session is visible without waiting for it to block
- [ ] 4.3 Verify the report says which agent each session belongs to, so two hosts' sessions are distinguishable

## 5. Verification and record

- [ ] 5.1 Every fixture payload in the tests copied from the measured probe, and verify a test cannot pass against a shape nobody observed
- [ ] 5.2 Show every guard failing when its property is broken, and record the output
- [ ] 5.3 Verify the same event delivered twice folds to one session, because two plugin instances are loaded on this machine
- [ ] 5.4 Record in the README what was measured against a live host and what was not, including that the permission path is deliberately unwired and why
- [ ] 5.5 Run the full suite and record the count
