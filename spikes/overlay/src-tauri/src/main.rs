// Overlay spike: can this platform keep a surface above windows that are not focused?
//
// Disposable. Everything it prints is a fact about the machine it ran on, not a
// property of this program. Read ../README.md for what to do with the answer.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::time::Duration;
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();

            // Probed from a thread, not inline in `setup`.
            //
            // `setup` runs before the event loop pumps, so anything asked
            // there is answered before it can be applied, and anything requested
            // there never is. An earlier version of this spike reported
            // `set_size -> 0x0` for exactly that reason: the probe was broken,
            // not Tauri.
            std::thread::spawn(move || {
                println!("=== OVERLAY SPIKE REPORT ===");
                println!("os                {}", std::env::consts::OS);
                println!("arch              {}", std::env::consts::ARCH);

                let Some(window) = handle.get_webview_window("mascot") else {
                    println!("RESULT            no window was created");
                    return;
                };

                println!(
                    "always_on_top     {:?}   <- flag accepted, NOT proof it is honoured",
                    window.is_always_on_top()
                );
                println!("decorated         {:?}", window.is_decorated());
                println!(
                    "focused_at_start  {:?}   <- must be false",
                    window.is_focused()
                );

                // Sampled on a timer so a size that settles after first layout
                // is distinguishable from one that never settles.
                for tick in 0..8 {
                    std::thread::sleep(Duration::from_secs(2));
                    let inner = window
                        .inner_size()
                        .map(|s| format!("{}x{}", s.width, s.height))
                        .unwrap_or_else(|e| format!("err:{e}"));
                    let outer = window
                        .outer_size()
                        .map(|s| format!("{}x{}", s.width, s.height))
                        .unwrap_or_else(|e| format!("err:{e}"));
                    let pos = window
                        .outer_position()
                        .map(|p| format!("{},{}", p.x, p.y))
                        .unwrap_or_else(|e| format!("err:{e}"));
                    println!(
                        "PROBE {tick:<2} inner={inner:<10} outer={outer:<10} pos={pos:<10} focused={:?}",
                        window.is_focused()
                    );
                }

                // Both of these are things a real panel depends on: dragging,
                // and taking focus when the user clicks the decision card.
                match window.set_position(tauri::PhysicalPosition::new(300, 300)) {
                    Ok(()) => println!("set_position      OK"),
                    Err(error) => println!("set_position      FAILED: {error}"),
                }
                std::thread::sleep(Duration::from_secs(1));
                println!(
                    "pos_after_move    {:?}   <- must not be unchanged",
                    window
                        .outer_position()
                        .map(|p| format!("{},{}", p.x, p.y))
                        .unwrap_or_default()
                );

                match window.set_focus() {
                    Ok(()) => println!("set_focus         OK"),
                    Err(error) => println!("set_focus         FAILED: {error}"),
                }
                std::thread::sleep(Duration::from_secs(2));
                println!("focused_after_req {:?}", window.is_focused());

                println!("=== END REPORT ===");
                println!("NOW WATCH IT: maximise a window over it, fullscreen something,");
                println!("type elsewhere while idle, and see whether it holds.");

                std::thread::sleep(Duration::from_secs(20));
                handle.exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start the overlay spike");
}