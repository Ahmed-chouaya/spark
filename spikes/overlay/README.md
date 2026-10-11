# Overlay spike

**Disposable. It exists to answer one question on a machine that has not answered it yet.**

> Can this platform keep a surface above other windows that are not focused?

On GNOME Wayland the answer is **no** — verified on Linux, where the flag reads back
`true` and is ignored, and the surface falls behind the moment the user looks elsewhere.
That result is recorded in `openspec/specs/escalation-surface/spec.md` and drove the
platform-conditional visibility rule.

This spike exists so the same question can be asked on **Windows**, where it has never
been run, and on **macOS**, which cannot be asked from Linux at all.

## Run it

```
rustup toolchain install stable        # once
cd spikes/overlay/src-tauri
cargo run --release
```

It opens a transparent, borderless, always-on-top panel with the mascot in it, prints a
report, and exits after about 26 seconds.

## What the report means

```
 always_on_top        the flag the runtime accepted — not proof it is honoured
 focused_at_start     must be false. a window that takes focus on appearing
                      steals the keyboard from whatever the user was doing
 PROBE n              geometry sampled on a timer, outside setup(), so the event
                      loop is actually pumping. the same number every tick means
                      the size settled; different numbers mean it is still moving
 pos                  must not be 0,0 — that is a surface stuck in the corner
 set_position         must move the window. OK without moving is a silent no-op
```

## The four things to watch with your eyes

Tests and probes answer three of the four questions. Only you can answer these:

1. **Maximise a window over it.** Does the surface stay above it?
2. **Put a fullscreen app over it** — a video, a game. Same question, harder answer.
3. **Type in another window** while it sits idle. Does your focus stay where you put it?
4. **Watch it for 26 seconds.** Does it flicker, jump, or settle late?

## After

Answer goes in the commit message, and `app-shell` gets written against it rather than
against an assumption. If the answer is "no", the capability probe already handles it and
`app-shell` needs no change — that is the point of having written the probe first.
