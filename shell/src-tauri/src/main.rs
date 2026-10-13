//! The Spark shell: a window, a channel, and the bytes between them.
//!
//! # What this program is allowed to know
//!
//! Three things, and the restraint is not modesty — it is what keeps
//! `src/state-selection/adapters/claude-code.ts` the single implementation of a
//! host agent's vocabulary:
//!
//! ```
//!   1. open a window, with the chrome the user did not ask for left off
//!   2. listen on the companion's channel
//!   3. move bytes from the channel into the webview, and answers back out
//! ```
//!
//! It parses no payload, names no event of a host's own, and derives no state.
//! A payload arrives, it is handed to the document as the bytes it was, and what
//! those bytes mean is decided in `src/relay/session-source.ts` by the adapter
//! that is already written and already tested against real payload shapes.
//!
//! `test/shell-shape.test.ts` reads this file and fails if a name from either
//! vocabulary appears in it, for the same reason `test/relay-shape.test.ts` does
//! for the relay: the property is about the *shape* of the program, and a
//! behaviour test would pass just as happily with an interpreter bolted on the
//! front.
//!
//! # What it does about the window
//!
//! The window's properties are declared once, in `tauri.conf.json`, and built
//! from that declaration here with `create: false` — so the settings the
//! requirements name are a document a test can read, and the code cannot drift
//! away from them.
//!
//! The window and its webview are built as **two steps**, which is unusual enough
//! to need saying. The capability report has to be read from the window itself —
//! a style bit on the real `HWND` on Windows, a level on the real `NSWindow` on
//! macOS — and the report has to reach the document before its first render,
//! because that is where the surface decides what it shows. One
//! `WebviewWindowBuilder::build()` cannot do both: it attaches the initialisation
//! script before any window exists to ask.
//!
//! So `WindowBuilder` builds the window, `capability::ask` reads the platform's
//! own answer off it, and `add_child` attaches a webview carrying that answer as
//! its initialisation script. The alternative — build in one step and `eval`
//! afterwards — is a race, not a shortcut: on WebView2 `eval` runs against
//! whatever document is current, which before the page has loaded is not the page.
//!
//! Three of the requirements are about *verifying* rather than requesting, and
//! they are why most of the reporting below exists:
//!
//! - `focus: false` is requested, and then read back once the event loop has
//!   pumped. A platform that ignores the request is reported, not raised: this is
//!   a platform limitation, and a shell that exits over it is a shell that does
//!   not run at all.
//! - a position is requested, and then read back. `docs/platform-findings.md`
//!   records `set_position` returning `Ok` and leaving the window at 0,0 on GNOME
//!   Wayland, so a successful call is not evidence that anything happened.
//! - the report published to the document is the platform's own answer, read off
//!   this window. See `capability.rs`.
//!
//! What none of this can check is whether the compositor honoured a stacking
//! request it agreed to. No API reports that. It is recorded as unmeasured in
//! `shell/README.md` rather than asserted here, because a test claiming it would
//! pass on every machine and mean nothing on any.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capability;
mod channel;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager, PhysicalPosition, WindowEvent};

/// The label of the one window this application opens.
///
/// Named rather than looked up by index, so a second window added later fails
/// here instead of quietly becoming something the user can see. The requirement
/// is "exactly one window carrying the mascot and no other interface", and the
/// cheapest way to keep that true is for the name to be a constant.
const COMPANION: &str = "companion";

/// The event carrying one payload's bytes from here to the document.
///
/// A name of this program's own, deliberately unlike anything a host agent
/// emits: the shape test forbids the host's vocabulary precisely so that this
/// one cannot be mistaken for it.
const PAYLOAD: &str = "spark://payload";

/// The document the webview loads.
///
/// `index.html` in the built frontend, named here rather than read out of
/// `tauri.conf.json`, because the window declaration is not what the webview
/// reads: `WebviewBuilder::from_config` takes no URL at all. The declaration
/// still records it so the file exists in one place a reader can find, and the
/// shell builds the webview from this.
const PAGE: &str = "index.html";

/// How long after start-up the window is asked whether it took the keyboard.
///
/// Long enough that the window has been created, laid out and given a chance to
/// be raised, and short enough that the answer is still the answer to "when it
/// appeared" rather than to "some time later".
const FOCUS_PROBE_DELAY: Duration = Duration::from_millis(500);

/// A rectangle in physical pixels, as the platform reports it.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// A point in physical pixels.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

/// The work area of the monitor the pointer is on, or `None` when the platform
/// will not say.
///
/// `None` is a real answer, and the caller places the window anyway: the
/// documented corner lives in `shell/src/placement.ts`, and refusing to start
/// over an unknown work area would trade a mascot in a known place for no mascot
/// at all.
#[tauri::command]
fn work_area(window: tauri::WebviewWindow) -> Result<Option<Rect>, ()> {
    let answer = (|| {
        let cursor = window.cursor_position().ok()?;
        let monitors = window.available_monitors().ok()?;

        // The monitor the pointer is over, and the nearest one when no monitor
        // claims it — a pointer on the seam between two belongs to whichever of
        // them its coordinates fall inside, and "nearest" is that answer.
        let nearest = monitors
            .iter()
            .min_by_key(|monitor| distance_to(&cursor, &monitor.work_area()))?;

        let area = nearest.work_area();

        Some(Rect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width,
            height: area.size.height,
        })
    })();

    Ok(answer)
}

/// How far outside this rectangle a point lies. Zero when it is inside.
fn distance_to(point: &PhysicalPosition<f64>, area: &tauri::PhysicalRect<i32, u32>) -> i64 {
    let x = point.x - f64::from(area.position.x);
    let y = point.y - f64::from(area.position.y);

    let outside_x = x.max(f64::from(area.position.x) - x).max(0.0) as i64;
    let outside_y = y.max(f64::from(area.position.y) - y).max(0.0) as i64;

    outside_x * outside_x + outside_y * outside_y
}

/// Move the window, then say where it actually ended up.
///
/// The return value is the read-back rather than the request, and that is the
/// whole of this command. `docs/platform-findings.md` records `set_position`
/// returning `Ok` and leaving the window at 0,0 on GNOME Wayland, so a caller
/// that trusted the call would place a mascot in a corner and call it working.
///
/// `None` when the window cannot say where it is is the honest answer too:
/// "unknown" is not "where I asked", and reporting the request back would make
/// the one check that exists report itself.
#[tauri::command]
fn place_window(window: tauri::WebviewWindow, x: i32, y: i32) -> Result<Option<Point>, ()> {
    if let Err(error) = window.set_position(PhysicalPosition::new(x, y)) {
        report(&format!("the window would not accept a position: {error}"));
        return Ok(None);
    }

    Ok(window.outer_position().ok().map(|position| Point {
        x: position.x,
        y: position.y,
    }))
}

/// Show or hide the window.
///
/// The only thing this program decides about visibility, and it decides nothing:
/// the document asks, having consulted `surfaceVisibility` in
/// `src/escalation/EscalationSurface.tsx`. There is no second opinion here to
/// have one.
#[tauri::command]
fn set_window_visible(window: tauri::WebviewWindow, visible: bool) {
    let outcome = if visible {
        window.show()
    } else {
        window.hide()
    };

    if let Err(error) = outcome {
        report(&format!("the window would not change visibility: {error}"));
    }
}

/// Say, on standard error, what the companion is holding.
///
/// ## Why this program says anything at all
///
/// On a platform that cannot keep a surface above other windows — GNOME, which
/// is what this was built on — **correct behaviour is an empty desktop**. The
/// window is created hidden and shown only while something is blocked, so a
/// working companion and a broken one look identical to somebody sitting in front
/// of the screen. That is not a defect in the visibility rule; it is the rule.
///
/// So the document, which is the only party that knows what the reduction made of
/// the payloads, reports it here and this program prints it. `npm run companion`
/// already inherits this program's streams, so it lands in a terminal with
/// nothing to configure.
///
/// The text is passed in rather than computed here on purpose. Which sessions
/// exist, which agent owns each and what state they are in are questions for the
/// reduction, and a Rust function answering any of them would be a second
/// implementation of it — the exact thing `main.rs`'s module note forbids.
#[tauri::command]
fn report_sessions(text: String) {
    for line in text.lines() {
        report(line);
    }
}

/// Bring the window forward so the user can answer it.
///
/// Only ever called for a decision the user has to act on, and only on a
/// platform that cannot keep the surface above their work without interrupting —
/// which is what `surfaceVisibility`'s `takesFocus` already decided. An ambient
/// window has no path to here at all.
#[tauri::command]
fn focus_window(window: tauri::WebviewWindow) {
    // Focusable first: the shell asks for a non-focusable window at start-up, so
    // that an ambient surface cannot be raised by the compositor later. Making it
    // focusable again is therefore part of asking for it rather than a separate
    // concern, and skipping it would turn "may interrupt" into "cannot be
    // reached", which is a card the user cannot answer.
    if let Err(error) = window.set_focusable(true) {
        report(&format!("the window would not become focusable: {error}"));
        return;
    }

    if let Err(error) = window.set_focus() {
        report(&format!("the window would not come forward: {error}"));
    }
}

/// Say something on standard error, in one shape.
///
/// A windowed build has no console, so these lines are the shell's only
/// diagnostics, and `npm run companion` runs it from a terminal where they can
/// be read. Every one is a sentence, because every one of them is the user being
/// told the platform did not do something this program asked it to, and the
/// difference between a report and a shrug is whether it can be acted on.
fn report(message: &str) {
    eprintln!("spark: {message}");
}

fn main() {
    tauri::Builder::default()
        .setup(move |app| {
            // Built from the declaration rather than from a second list of
            // properties, so `tauri.conf.json` stays the one place the window's
            // chrome is described. `create: false` in that file is what puts this
            // in our hands at all: nothing exists to measure until we build it,
            // and nothing to publish into until we attach a webview.
            let declared = app
                .config()
                .app
                .windows
                .first()
                .ok_or("tauri.conf.json declares no window")?
                .clone();

            // Step one: the window, with no webview in it yet. Every platform's
            // question except Wayland's is a question about this object — its
            // handle, its level — so it has to exist before it can be asked.
            let window = tauri::window::WindowBuilder::from_config(app.handle(), &declared)?.build()?;

            // Step two: the answer, read from the window the platform gave us,
            // and not from anything this host requested. On a platform that has
            // no such mechanism the answer is `unknown`, which selects the
            // escalate-only behaviour — correct everywhere, and correct for this
            // shell on GNOME, where Mutter does not implement the layer protocol.
            let published =
                capability::initialization_script(&capability::capability_report(&window));

            // What this host decided, said out loud.
            //
            // A window that is *supposed* to be absent and a window that is
            // broken look identical from the outside: nothing on screen, nothing
            // on stderr. That is the state this project found itself in more than
            // once — `npm run doctor` can report everything, but it cannot tell
            // somebody staring at an empty desktop whether the companion is
            // working correctly or failing silently, because on a platform that
            // cannot float, "working correctly" *is* an empty desktop.
            //
            // So the startup line names both halves: the question that was asked
            // and the answer that came back. Everything after this is an
            // explanation for what that answer means, and the answer is the whole
            // of it.
            {
                let report_value = capability::capability_report(&window);
                report(&format!(
                    "floating surface: asked {:?}, platform answered held={} -> {}",
                    report_value.placement,
                    report_value.held,
                    if report_value.held {
                        "visible whenever nothing is blocked"
                    } else {
                        "visible only while something is blocked"
                    }
                ));
            }

            // Step three: the webview, carrying that answer as an initialisation
            // script so it is in the document before any of the page's own
            // JavaScript runs. `add_child` runs inline on the main thread, so
            // this is two steps rather than a deadlock.
            // `WebviewBuilder::from_config` reads only `WebviewAttributes` — it
            // takes no URL. `WebviewBuilder::new` takes the label and a
            // `WebviewUrl`, and that is the constructor that decides what the
            // document actually loads.
            //
            // So `from_config` alone would attach a webview with no page in it:
            // the window appears, the channel binds, payloads are received, and
            // nothing renders and nothing reports, because no JavaScript ever
            // ran. Found by running the built window — 672 tests pass and not one
            // of them can tell whether a document loaded.
            let child = tauri::webview::WebviewBuilder::new(
                &declared.label,
                tauri::WebviewUrl::App(PAGE.into()),
            )
                .initialization_script(published);

            let attached = window.add_child(
                child,
                tauri::LogicalPosition::new(0.0, 0.0),
                window.inner_size()?,
            );

            attached?;

            let window = app
                .get_webview_window(COMPANION)
                .ok_or("the companion window was not created")?;


            // Not focusable at all until something needs it. `focus: false` stops
            // the window *taking* focus as it appears; this stops the compositor
            // handing it to the user later, which is the other half of "an
            // ambient window never takes focus".
            if let Err(error) = window.set_focusable(false) {
                report(&format!(
                    "the window would not give up the keyboard: {error}; \
                     it may interrupt while there is nothing to say"
                ));
            }

            let channel = channel::open({
                let window = window.clone();
                move |payload| {
                    // The bytes, unchanged. Everything that knows what they mean
                    // is in the document, in TypeScript, where it is tested.
                    if let Err(error) = window.emit(PAYLOAD, payload) {
                        report(&format!("a payload could not reach the window: {error}"));
                    }
                }
            })?;

            // Behind a mutex because `close` has to *mutate* the channel to take
            // its reader thread, and the window's event callback is a `Fn` rather
            // than a `FnMut`. The lock is only ever held for the length of a
            // shutdown, which is the one time nothing else is happening.
            let channel = Arc::new(Mutex::new(channel));
            let application = app.handle().clone();

            window.on_window_event(move |event| {
                // Closing the window ends the companion: a companion with no
                // window cannot do the one thing it is for, and one that lingers
                // behind an invisible surface would hold the channel without ever
                // answering a hook. `exit` rather than returning into an event
                // loop with nothing on screen.
                if matches!(event, WindowEvent::Destroyed) {
                    if let Ok(mut channel) = channel.lock() {
                        channel.close();
                    }
                    application.exit(0);
                }
            });

            // Probed from a thread rather than inline in `setup`, for the reason
            // `spikes/overlay` found the hard way: `setup` runs before the event
            // loop pumps, so anything asked there is answered before it can be
            // applied. An earlier version of that spike reported `0x0` for a
            // window that had not yet been given a chance to exist.
            let probed = window.clone();
            thread::spawn(move || {
                thread::sleep(FOCUS_PROBE_DELAY);

                if let Ok(true) = probed.is_focused() {
                    report(
                        "the window took the keyboard when it appeared, which this platform \
                         does not let us prevent",
                    );
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            work_area,
            place_window,
            set_window_visible,
            focus_window,
            report_sessions
        ])
        .run(tauri::generate_context!())
        .expect("the shell could not start");
}
