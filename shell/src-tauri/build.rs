// The window's own configuration lives in `tauri.conf.json`, so this is the
// step that reads it and fails loudly if it is not a Tauri configuration at
// all. Deliberately no arguments: a build script that can be told what to
// generate is a build script that can generate something other than the shell.
fn main() {
    tauri_build::build()
}
