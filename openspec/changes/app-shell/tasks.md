# Tasks

## 1. The host window

- [ ] 1.1 Scaffold `shell/` as a Tauri application whose window is transparent, undecorated, always-on-top, absent from the taskbar and initially hidden, and verify each setting the "unadorned" requirement names is present in the window configuration
- [ ] 1.2 Create the window so it is not the focused window when it appears, and verify the request is made and that a failure to prevent focus is reported rather than raised
- [ ] 1.3 Place the window using the work area of the monitor the cursor is on, falling back to a documented corner when the work area cannot be determined, and verify the fallback places the window somewhere visible rather than failing to start
- [ ] 1.4 Verify a position request took effect by reading the position back, and report a mismatch rather than trusting the call's return value
- [ ] 1.5 Close the window and release the channel when the companion is asked to stop, and verify a later start is not blocked by the previous one's channel

## 2. Publishing the platform's answer

- [ ] 2.1 Read back the protocols the platform actually granted the window's surface, and verify a granted protocol is reported and an absent one is not
- [ ] 2.2 Publish the grant — not the request — at `globalThis.__SPARK_HOST_WINDOW__` before the surface's first render, using an initialisation script rather than a write at setup time, and verify the document reads it before any of the page's own JavaScript runs
- [ ] 2.3 Implement the report as a pure function of the granted list, and verify an empty list, an absent list and a list naming only other protocols each produce a host that cannot hold a persistent surface
- [ ] 2.4 Verify a host reporting a layer it was not granted cannot be produced, since that is the one failure the probe's module note warns about

## 3. The companion runtime

- [ ] 3.1 Open the relay's channel from the host and deliver received payloads to the frontend unchanged, and verify a payload sent to the channel arrives byte-identical
- [ ] 3.2 Feed payloads through the existing host adapter into the existing fold, and verify a session started by the host reaches the surface with no caller supplying it
- [ ] 3.3 Mount the existing escalation surface on the result, and verify no state is re-derived: the rendered state is the reduction's, on every path
- [ ] 3.4 Show and hide the window according to `surfaceVisibility`, and verify a block appears on a platform that cannot float, resolves back to absent, and that the shell holds no opinion of its own about when to be visible

## 4. Keeping the shell a shell

- [ ] 4.1 Add a test that reads the shell's Rust source and asserts it names no host event, no mascot state and no session field, so a second implementation of the host's vocabulary cannot be added quietly
- [ ] 4.2 Verify `src/state-selection`, `src/components/mascot` and `src/relay` gain no requirement and no code path from the shell, and that none of them imports anything from `shell/`
- [ ] 4.3 Make `npm run companion` the shell rather than a printer, and verify the reduction that was printed is now mounted
- [ ] 4.4 Verify the shell does not install hooks as a side effect of starting, since that is a separate command that asks first

## 5. Verification and record

- [ ] 5.1 Add e2e coverage of the shell's rendered surface driving a session to blocked and back, through the window the way a user reaches it
- [ ] 5.2 Record in `shell/README.md` which platform behaviours were measured and which were not, one row per platform, carrying no machine's answer to another machine's row
- [ ] 5.3 Verify on Windows that the window stays above a maximised window and does not take focus while the user types elsewhere, and record the result
- [ ] 5.4 Run the full suite and record the count, so the Windows run has a baseline to compare against
