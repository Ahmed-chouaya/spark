# Tasks

## 1. The host window

- [x] 1.1 Scaffold `shell/` as a Tauri application whose window is transparent, undecorated, always-on-top, absent from the taskbar and initially hidden, and verify each setting the "unadorned" requirement names is present in the window configuration
- [x] 1.2 Create the window so it is not the focused window when it appears, and verify the request is made and that a failure to prevent focus is reported rather than raised
- [x] 1.3 Place the window using the work area of the monitor the cursor is on, falling back to a documented corner when the work area cannot be determined, and verify the fallback places the window somewhere visible rather than failing to start
- [x] 1.4 Verify a position request took effect by reading the position back, and report a mismatch rather than trusting the call's return value
- [x] 1.5 Close the window and release the channel when the companion is asked to stop, and verify a later start is not blocked by the previous one's channel

## 2. Publishing the platform's answer

- [x] 2.1 Read back the protocols the platform actually granted the window's surface, and verify a granted protocol is reported and an absent one is not
- [x] 2.2 Publish the grant — not the request — at `globalThis.__SPARK_HOST_WINDOW__` before the surface's first render, using an initialisation script rather than a write at setup time, and verify the document reads it before any of the page's own JavaScript runs
- [x] 2.3 Implement the report as a pure function of the granted list, and verify an empty list, an absent list and a list naming only other protocols each produce a host that cannot hold a persistent surface
- [x] 2.4 Verify a host reporting a layer it was not granted cannot be produced, since that is the one failure the probe's module note warns about

## 3. The companion runtime

- [x] 3.1 Open the relay's channel from the host and deliver received payloads to the frontend unchanged, and verify a payload sent to the channel arrives byte-identical
- [x] 3.2 Feed payloads through the existing host adapter into the existing fold, and verify a session started by the host reaches the surface with no caller supplying it
- [x] 3.3 Mount the existing escalation surface on the result, and verify no state is re-derived: the rendered state is the reduction's, on every path
- [x] 3.4 Show and hide the window according to `surfaceVisibility`, and verify a block appears on a platform that cannot float, resolves back to absent, and that the shell holds no opinion of its own about when to be visible

## 4. Keeping the shell a shell

- [x] 4.1 Add a test that reads the shell's Rust source and asserts it names no host event, no mascot state and no session field, so a second implementation of the host's vocabulary cannot be added quietly
- [x] 4.2 Verify `src/state-selection`, `src/components/mascot` and `src/relay` gain no requirement and no code path from the shell, and that none of them imports anything from `shell/`
- [x] 4.3 Make `npm run companion` the shell rather than a printer, and verify the reduction that was printed is now mounted
- [x] 4.4 Verify the shell does not install hooks as a side effect of starting, since that is a separate command that asks first

## 5. Verification and record

- [x] 5.1 Add e2e coverage of the shell's rendered surface driving a session to blocked and back, through the window the way a user reaches it
- [x] 5.2 Record in `shell/README.md` which platform behaviours were measured and which were not, one row per platform, carrying no machine's answer to another machine's row
- [ ] 5.3 Verify on Windows that the window stays above a maximised window and does not take focus while the user types elsewhere, and record the result — **not done, and not possible from this machine.** No Windows host was available, so the shell has never been run there. `shell/README.md` records it as unmeasured rather than carrying the spike's observation across, and the reason it would not answer the question anyway is written up in `docs/platform-findings.md`: the granted protocol list is empty on every platform Tauri can open a window on, so a Windows run today would measure the escalate-only path. What is pinned structurally instead is the shape of the Windows branch — one named pipe path for the channel, no `process.platform` branching on the hook side — by `test/shell-channel.test.ts` and `test/shell-shape.test.ts`.
- [x] 5.4 Run the full suite and record the count, so the Windows run has a baseline to compare against

## Recorded

| Suite | Before this change | After |
|---|---|---|
| `npm run verify` (vitest, `test/**`) | 38 files, 386 tests | 44 files, **473 tests** |
| `cargo test --manifest-path shell/src-tauri/Cargo.toml` | did not exist | **11 tests** |
| `npm run test:e2e` (`tests/*.e2e.ts`) | 2 files, 15 tests | 3 files, **25 tests** (10 of them the shell's) |
