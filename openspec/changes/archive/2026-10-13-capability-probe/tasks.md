# Tasks

## 1. The question, reshaped

- [x] 1.1 Replace the protocol list with a report naming the mechanism each platform was asked about and the answer it gave, and verify a reader can tell which question produced the answer
- [x] 1.2 Keep "the platform said no" distinguishable from "the platform could not be asked", because conflating them loses the audit trail, and verify both produce escalate-only
- [x] 1.3 Verify a report naming no platform at all is read as escalate-only rather than as an error, since that is what a plain browser document is and it is a real answer
- [x] 1.4 Keep every non-affirmative answer producing escalate-only, and verify each of them individually

## 2. Asking each platform

- [x] 2.1 On Windows, read the topmost extended style bit from the real window handle, and verify it is the kernel's answer about a real window rather than anything the host recorded
- [x] 2.2 On macOS, read the window's level through the runtime's own query, and record that this is the one platform where the obvious API was already a real query rather than a write-echo
- [x] 2.3 On Wayland, report the layer protocol only if a layer surface was actually bound, and verify Tauri creating a toplevel yields no layer surface and therefore no claim of one
- [x] 2.4 Verify a platform that cannot answer reports the question as unaskable rather than reporting "no", so the two answers keep their different consequences

## 3. Not publishing our own request

- [x] 3.1 Verify the published answer is read from the platform's state and never from a value the host set itself
- [x] 3.2 Add a structural test that fails if the Rust side calls the runtime's `is_always_on_top`, because on two of three platforms that returns the host's own request rather than the platform's answer — and it is named like a verification, which is why it would survive review
- [x] 3.3 Show the guard failing by calling it, and record the output
- [x] 3.4 Verify every existing capability test is rewritten rather than deleted, since they all encoded the question that was wrong

## 4. What follows from it

- [x] 4.1 Verify the shell publishes the new report shape and the surface reads it, end to end through the real template
- [x] 4.2 Verify the companion is persistent when the platform says it is, and escalate-only when it does not, on both branches
- [x] 4.3 Verify nothing else in `escalation-surface` changes — the visibility rule, the focus rule and the sizing rule consume the capability and are unaffected by what changed shape

## 5. Record

- [x] 5.1 Update `shell/README.md` and `docs/platform-findings.md` to say which question each platform is now asked, and record that reading a bit correctly is not the same as the platform honouring it
- [x] 5.2 Mark macOS persistent in the findings as what the code will now do, and unmeasured, because no Mac has run it
- [x] 5.3 Record that Windows becoming persistent is the code following an observation already made by hand, and that re-running it on the real shell is the check that confirms it
- [x] 5.4 Run the full suite and record the count, including that `cargo test` is still not part of `npm run verify` and what it covers that vitest does not

## Deviations from `design.md`, and why

Three things the design did not account for, all forced by asking the question
of the real window rather than of the configuration.

**The window has to exist before it can be asked.** The design has
`granted_protocols()` running before the window is built and the report reaching
the document as an initialisation script. That is not possible for the Windows
and macOS questions, which are questions about a window handle and a window
level. `main.rs` now builds the window with `WindowBuilder`, measures it, and
attaches the webview with `add_child` carrying the report — the only ordering in
which the answer is both the platform's own and present for the document's first
render. One `WebviewWindowBuilder::build()` cannot do both, and the alternative of
building in one step and `eval`ing the report afterwards is a race: on WebView2,
`eval` runs against whatever document is current, which before the page has
loaded is not the page. This costs `tauri`'s `unstable` feature.

**`is_always_on_top()` is not used even on macOS**, where it is a genuine query.
The design says to use it there. The guard in task 3.2 is a structural test that
fails if the Rust calls it *at all*, and a guard with a per-platform exception is
a guard with a hole in it — the hole is one line long and would be written by
somebody in a hurry who had read the source of `tao` and concluded it was fine on
that platform. macOS reads `NSWindow::level()` directly instead.

**The design's "already a genuine query" is about the level, not the accessor.**
Re-reading it, "already a genuine query" is true of what `is_always_on_top()` does
on macOS; the design does not say to call it. Reading the level directly is
consistent with the design's table and with its own reasoning.

## Unverified, and what would verify it

- **Whether Windows keeps the window on top.** The probe reads a style bit the
  kernel holds; it cannot observe stacking. The Windows row rests on the
  observation already recorded by hand in `docs/platform-findings.md`. Running the
  shell on Windows against a maximised window is the check, and it is the same
  check that produced the observation.
- **Whether macOS floats.** Never run. The code will ask; no Mac was available.
- **That the two platform code paths run at all.** Both were checked for their real
  targets in scratch crates — `GetWindowLongW` and the handle cast against
  `windows-sys` 0.61 for `x86_64-pc-windows-msvc`, `NSWindow::level` against
  `objc2-app-kit` 0.3 for `x86_64-apple-darwin` — but this machine cannot build the
  full crate for either target (`llvm-rc` for the Windows resource file, a C
  toolchain for `objc2`'s Objective-C sources), so the surrounding code on those
  two platforms has not been compiled by any tool.