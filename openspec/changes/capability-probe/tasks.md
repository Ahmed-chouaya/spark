# Tasks

## 1. The question, reshaped

- [ ] 1.1 Replace the protocol list with a report naming the mechanism each platform was asked about and the answer it gave, and verify a reader can tell which question produced the answer
- [ ] 1.2 Keep "the platform said no" distinguishable from "the platform could not be asked", because conflating them loses the audit trail, and verify both produce escalate-only
- [ ] 1.3 Verify a report naming no platform at all is read as escalate-only rather than as an error, since that is what a plain browser document is and it is a real answer
- [ ] 1.4 Keep every non-affirmative answer producing escalate-only, and verify each of them individually

## 2. Asking each platform

- [ ] 2.1 On Windows, read the topmost extended style bit from the real window handle, and verify it is the kernel's answer about a real window rather than anything the host recorded
- [ ] 2.2 On macOS, read the window's level through the runtime's own query, and record that this is the one platform where the obvious API was already a real query rather than a write-echo
- [ ] 2.3 On Wayland, report the layer protocol only if a layer surface was actually bound, and verify Tauri creating a toplevel yields no layer surface and therefore no claim of one
- [ ] 2.4 Verify a platform that cannot answer reports the question as unaskable rather than reporting "no", so the two answers keep their different consequences

## 3. Not publishing our own request

- [ ] 3.1 Verify the published answer is read from the platform's state and never from a value the host set itself
- [ ] 3.2 Add a structural test that fails if the Rust side calls the runtime's `is_always_on_top`, because on two of three platforms that returns the host's own request rather than the platform's answer — and it is named like a verification, which is why it would survive review
- [ ] 3.3 Show the guard failing by calling it, and record the output
- [ ] 3.4 Verify every existing capability test is rewritten rather than deleted, since they all encoded the question that was wrong

## 4. What follows from it

- [ ] 4.1 Verify the shell publishes the new report shape and the surface reads it, end to end through the real template
- [ ] 4.2 Verify the companion is persistent when the platform says it is, and escalate-only when it does not, on both branches
- [ ] 4.3 Verify nothing else in `escalation-surface` changes — the visibility rule, the focus rule and the sizing rule consume the capability and are unaffected by what changed shape

## 5. Record

- [ ] 5.1 Update `shell/README.md` and `docs/platform-findings.md` to say which question each platform is now asked, and record that reading a bit correctly is not the same as the platform honouring it
- [ ] 5.2 Mark macOS persistent in the findings as what the code will now do, and unmeasured, because no Mac has run it
- [ ] 5.3 Record that Windows becoming persistent is the code following an observation already made by hand, and that re-running it on the real shell is the check that confirms it
- [ ] 5.4 Run the full suite and record the count, including that `cargo test` is still not part of `npm run verify` and what it covers that vitest does not
