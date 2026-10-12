# Platform findings

What each platform was measured doing, and where. Read this before writing anything that
depends on a window being above another window.

The rule the companion follows — *visibility follows platform capability* — only holds if
the capability is measured rather than assumed. These are the measurements.

## Summary

| | GNOME Wayland | Windows 11 | macOS |
|---|---|---|---|
| can hold a surface above unfocused windows | **no** | **yes** | not measured |
| background present, ambient | no | yes | not measured |
| transparent background | yes | yes | not measured |
| stays above a maximised window | **no** | **yes** | not measured |
| takes focus when it appears | **yes, within ~2s** | **no** | not measured |
| requested window size honoured | **no** (140x150 → 200x239) | not measured | not measured |
| `set_position` honoured | **no** (returns OK, stays at 0,0) | not measured | not measured |
| what the capability probe asks | layer surface bound? | topmost style bit on the real handle? | window level floating? |
| what it answered, as read by the shell | **`false`** — Tauri opens toplevels | **not measured**; the code will ask, and the observation above says yes | **not measured**; the code will ask |

Two rows are about *this repository's probe* rather than about the platform, and
they are kept separate from the behavioural rows on purpose. "Windows floats" is
an observation somebody made by hand. "The shell reports a persistent surface on
Windows" is what the code will now do — and it has not been run there.

## Why the probe asks each platform a different question

The probe used to ask one question everywhere: *did the compositor grant
`zwlr_layer_shell_v1` to this window's surface?*

That is the right question for a Wayland compositor, and a meaningless one
anywhere else. Windows and macOS have no compositor and no protocols, and will
never grant a Wayland protocol to anything. Tauri creates toplevels and cannot
create a layer surface on any platform, so the read came back empty on all
three — and an empty list was read as "no platform can float a persistent
surface" when what had actually been measured was "no host asked a question these
platforms understand".

The empty answer was true. The inference was the bug, and it cost the persistent
companion on the one platform in this table where it demonstrably works.

So each platform is now asked something it can answer about itself, and the
report names which question was asked next to what it answered. See
`shell/src-tauri/src/capability.rs`.

## What reading a style bit does and does not prove

The Windows read is `GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST` on this
window's real handle. That is a fact the kernel holds about a real window, and
it is materially different from reading back a flag the host set — which is all
that happens on the other platforms and is documented above.

**It does not prove the window then stayed above other windows.** No API reports
that. The kernel can grant the style and the window manager can still put
something else on top. So the Windows row above rests on the hand observation —
the surface stayed above every window tested, including a maximised one — and the
probe neither strengthens nor weakens it. Re-running the shell on Windows is the
check that would confirm the code follows the observation; until then it is
recorded as what the code will do rather than as what the code did.

## Linux — GNOME 44, Wayland, `zwlr_layer_shell_v1` not granted

The escalate-only path exists because of this row set.

A floating window cannot be kept above other windows. The compositor owns stacking for
Wayland clients and, without the layer-shell protocol, there is no way to ask. The request
is accepted — `is_always_on_top()` reads back `true` — and then ignored, which is the worst
possible shape: the flag is not evidence.

Observed: the surface sits above other windows only while it holds focus, and falls behind
the moment the user looks elsewhere. It also **takes focus within about two seconds**,
which is exactly the behaviour this product exists to avoid.

Two further surprises, both recorded because they cost time:

- **The requested size is not honoured.** 140x150 came back as 200x239, stably. The same
  request on the XWayland path came back as exactly 140x110. Hence
  `escalation-surface`'s "sized by its content" requirement.
- **`set_position` returns success and does nothing.** The window stays at 0,0. A drag
  handler and a persisted position cannot rely on it here.

Probe: `node scripts/probe-capability.mjs` → `can hold a persistent surface: false`,
asked `wayland-layer`.

## Windows 11

**A persistent surface works.** The companion's primary experience is available.

Verified by observation, not only by the probe: the surface stayed above every window
tested, including a maximised one, and did not take focus when the user typed elsewhere.
That is the whole of the persistent branch, and it is confirmed on real hardware.

`app-shell` shipped reporting this shell as escalate-only *here as well*, and the
disagreement was the finding. The probe read the granted protocol list back before it
opened its window and published exactly what it was given, and on every platform Tauri
can open a window on that list is empty. So the shell reported a capability it could
demonstrate nowhere as missing on a platform where it works.

**That is now fixed, and the fix is not a new observation.** The probe asks Windows
whether `WS_EX_TOPMOST` is set on the real window handle, which is a question Windows
can answer, and the answer follows the observation above: a persistent surface. **This
shell has not been run on Windows**, so the row is recorded as what the code will do.
The check that confirms it is the same one that produced the observation in the first
place — run the shell and watch the window against a maximised one.

## macOS

**Not measured.** It cannot be measured from Linux, and no Mac was available. Everything in
this column above is unknown.

The code will now ask this platform whether the window's level is a floating level,
which on macOS is a genuine query rather than a read-back of the host's own flag, and
the answer will be whatever a Mac says. **That is a prediction, not a result**, and it is
recorded as such: the platform becomes persistent in the code and is unmeasured in fact.

What is *not* unknown: v0.1 on macOS is a plain floating panel, which is well-trodden
(`NSPanel` at `.floating`). The genuinely hard macOS work — the notch — is deferred to
v0.2. So this row is a gap in the evidence, not a known problem.

Treat macOS as untested rather than as working, and re-run `spikes/overlay` on a Mac before
relying on any of it.

## How each row was measured

`spikes/overlay` — a disposable Tauri program that opens a transparent, borderless,
always-on-top panel, prints a report, and exits. Two halves:

- **The probe answers what the runtime reports.** Size, position, focus and the
  always-on-top flag, sampled on a timer outside `setup()` so the event loop is pumping.
  Earlier versions of the spike measured inside `setup()` and reported `0x0` and `OK` for
  things that had not happened — the probe was broken, not the platform.
- **Only a person answers whether it actually stayed on top.** No test can observe stacking.

`node scripts/probe-capability.mjs` reports which mechanism each platform was asked
about, what it answered, and the environment it ran in, because the three have to agree.