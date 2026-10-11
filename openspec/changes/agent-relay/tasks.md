# Tasks

## 1. Local channel

- [x] 1.1 Define the companion's address as a documented path derived from the owning user's identity, the same on Linux and Windows, and verify two users resolve to different addresses
- [x] 1.2 Implement the companion's listener that creates the channel with access restricted to the owning user, and verify a connection from another user is refused
- [x] 1.3 Implement replacement of a channel left behind by an unclean exit, and verify the companion starts and becomes available rather than refusing to start
- [x] 1.4 Add tests that the address is derivable independently by both sides with nothing negotiated between them, and verify neither side is told the other's location

## 2. The relay

- [x] 2.1 Implement the relay as reading a payload from standard input, delivering it to the channel, and exiting, and verify a payload sent to it arrives unchanged
- [x] 2.2 Verify the relay exits without waiting for a response, acknowledgement, or timeout, and that a companion that never reads the delivered payload does not delay the relay
- [x] 2.3 Verify the relay exits successfully when no companion is listening, when the channel does not exist, and when the input is unusable, and that nothing unusable reaches the companion's state selection
- [x] 2.4 Add a test that reads the relay's source and asserts it contains no interpretation of the host's event vocabulary, so a second implementation of that contract cannot be added quietly
- [x] 2.5 Add a test that the relay starts and delivers on a machine with no project dependencies present, and verify it does not require a language runtime or installed package

## 3. Hook installation

- [x] 3.1 Implement installation that does nothing until explicitly requested, and verify an install with no explicit request leaves the host's configuration untouched
- [x] 3.2 Show the proposed configuration change before writing anything, and verify declining it leaves the file exactly as it was
- [x] 3.3 Back up the host's configuration before changing it, and verify the prior configuration is recoverable after an install
- [x] 3.4 Merge the companion's hooks with existing ones rather than replacing them, and verify a pre-existing hook the companion did not add survives an install
- [x] 3.5 Make installation idempotent, and verify installing twice leaves one copy of each companion hook
- [x] 3.6 Add tests covering install, decline, backup, merge with existing hooks and repeat install, and verify each leaves the configuration in the state the requirement names

## 4. Wiring sessions

- [ ] 4.1 Feed received payloads through the existing host adapter into the state selection's fold, and verify a session started by the host reaches the companion with no caller supplying it
- [ ] 4.2 Verify the reduction is unchanged for host-sourced sessions, covering precedence, primary selection, classification and the escalation rule, and that no separate path decides the rendered state
- [ ] 4.3 Verify adding a second host agent requires no change to the relay, and that the translation remains in one place per host
- [ ] 4.4 Verify the relay path leaves the caller-supplied session route working unchanged, so the companion is still usable with no relay installed

## 5. Integration check

- [ ] 5.1 Install the hooks against the real host agent on this machine, start the companion, and verify in one pass that a session started in a terminal reaches the surface without being supplied
- [ ] 5.2 Verify a blocked session surfaces the escalation through the relay, and verify the decision card cannot yet be answered from it, which is the documented boundary of this change
- [ ] 5.3 Stop the companion, invoke a hook, and verify the host agent proceeds unaffected and no error is surfaced
- [ ] 5.4 Uninstall and verify the host's configuration returns to its prior state and the backup remains recoverable
- [ ] 5.5 Document in the relay's source why it translates nothing and why it exits without waiting, and verify each claim is stated where a future editor will read it