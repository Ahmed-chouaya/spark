# Proposal

## Why

`app-shell` shipped, and it reported — honestly, and with the reasoning written down — that
the companion is escalate-only on every platform. On Windows 11, where a persistent surface
has been observed working on real hardware.

The report was faithful and the conclusion was wrong, and the gap between them is a bug in
the question rather than a fact about the platform.

The probe asks: *did the compositor grant `zwlr_layer_shell_v1` to this window's surface?*
That is the correct question **for a Wayland compositor**, where the compositor owns
stacking and the layer protocol is the only way into a stack of its own. It is not a
question Windows or macOS can answer, because neither has protocols, neither has a
compositor, and neither will ever grant a Wayland protocol to anything.

So the probe returns `[]` everywhere, and reads as "no platform can float a persistent
surface" when what it actually measured is "no host asked a question these platforms
understand."

## What Changes

- The capability question becomes one each platform can answer about itself:
  - **Wayland** — did the compositor bind a layer surface to this window? Same question as
    before, and the same honest answer on GNOME.
  - **Windows** — is the topmost style bit set on the real window handle? A fact the kernel
    holds, not one the host asserted.
  - **macOS** — is the window's level floating? A real query, which Tauri already performs.
- The report names the *mechanism* the platform used rather than a protocol string, because
  "the compositor granted this protocol" and "the window has this style bit set" are
  different facts and flattening them into one vocabulary would be how the original question
  came to be asked in the wrong shape.
- The failure direction is unchanged: a platform that cannot answer reports nothing, and the
  surface selects escalate-only. That answer is correct everywhere and its opposite is
  correct nowhere.
- The shell publishes what was *verified*, and a write-echo is not a verification.

## Capabilities

### New Capabilities

None. This corrects how an existing requirement is measured rather than adding behaviour.

### Modified Capabilities
- `escalation-surface`: "Platform capability is detected rather than assumed" changes what
  is detected. It currently names the layer protocol as the deciding fact; that is the
  deciding fact on Wayland and a category error on Windows and macOS. The requirement
  becomes "each platform is asked in its own terms".

## Impact

- `src/escalation/capability.ts` — the report shape, and the question.
- `shell/src-tauri/src/capability.rs` — the per-platform measurement.
- `shell/src-tauri/src/main.rs` — reads the platform's answer instead of an empty list.
- **The product's headline behaviour on Windows changes**: the companion becomes persistent
  there, which is what `docs/platform-findings.md` observed and what the user can actually
  use.
- Every capability test is rewritten, because they all encoded the wrong question.
