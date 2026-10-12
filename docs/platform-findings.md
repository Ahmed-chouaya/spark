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

Probe: `node scripts/probe-capability.mjs` → `can hold a persistent surface: false`.

## Windows 11

**A persistent surface works.** The companion's primary experience is available.

Verified by observation, not only by the probe: the surface stayed above every window
tested, including a maximised one, and did not take focus when the user typed elsewhere.
That is the whole of the persistent branch, and it is confirmed on real hardware.

The probe was not captured on this platform in the same run, so
`canHoldPersistentSurface()` returning `true` here is *inferred* from the behaviour rather
than read from the granted protocol list. `app-shell` was asked to confirm both agree.

**They do not agree, and the disagreement is the finding.** The shell reads the granted
protocol list back before it opens its window and publishes exactly what it was given —
see `shell/src-tauri/src/capability.rs`. On every platform Tauri can open a window on,
that list is empty: `zwlr_layer_shell_v1` places a client in a layer by *replacing* the
role a window would otherwise have, and Tauri's backend creates toplevels. So the shell
runs escalate-only here too, including on Windows 11, where the observation above says a
persistent surface would work.

That is the safe direction and it is correct everywhere, but it costs the persistent
companion the platform can actually provide. It is recorded in `shell/README.md` rather
than worked around, and it is the honest consequence of defining the capability as a
protocol list rather than as a boolean this project would have to guess at per platform.

## macOS

**Not measured.** It cannot be measured from Linux, and no Mac was available. Everything in
this column above is unknown.

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

`node scripts/probe-capability.mjs` reports whether the compositor granted
`zwlr_layer_shell_v1`, alongside the environment it ran in, because the two have to agree.