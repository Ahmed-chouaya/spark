import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The window's own configuration.
 *
 * Every requirement about how the window *looks* is answered by a declaration
 * rather than by code, which is why these read `tauri.conf.json` and not
 * `main.rs`. A document a test can read is a document a test can hold to; the
 * alternative is asserting that a Rust call site mentions a property name, which
 * says the string is present and nothing about whether the window has it.
 *
 * The properties that are *requests* — `focus: false`, `alwaysOnTop` — are a
 * different kind of claim, and the design is explicit that they are not
 * evidence: `docs/platform-findings.md` records `always_on_top` reading back
 * `true` on GNOME Wayland while being ignored. So each one here is paired with
 * the read-back that would expose a platform disagreeing, and none of them is
 * treated as proof that the platform obeyed.
 */

const ROOT = join(import.meta.dirname, "..");
const CONFIG = join(ROOT, "shell/src-tauri/tauri.conf.json");
const MAIN = join(ROOT, "shell/src-tauri/src/main.rs");

interface WindowConfig {
  readonly [setting: string]: unknown;
}

const config = JSON.parse(readFileSync(CONFIG, "utf8")) as {
  readonly build: { readonly frontendDist: string };
  readonly app: { readonly windows: readonly WindowConfig[] };
  readonly bundle: { readonly active: boolean };
};

/** The one window the application declares. */
const theWindow = (): WindowConfig => {
  expect(config.app.windows, "the shell declares exactly one window").toHaveLength(1);
  return config.app.windows[0]!;
};

/** The Rust source, with comments removed so prose cannot satisfy a check. */
const mainCode = (): string =>
  readFileSync(MAIN, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

describe("the companion is one window carrying nothing else", () => {
  it("declares exactly one window", () => {
    // "Exactly one window carrying the mascot and no other interface". A second
    // declaration is a second thing the user can see, and nothing in the design
    // asks for one.
    expect(config.app.windows).toHaveLength(1);
    expect(theWindow().label).toBe("companion");
  });

  it("is bundled, which is a decision `packaging` made and this change reversed", () => {
    // Recorded as a line somebody reads while fixing something else. The shell
    // used to declare `active: false` with the note that bundling was a product
    // decision nothing had made; `packaging` made it, and the bundle is now part
    // of `npm run build`. The per-platform target lists live beside this file as
    // `tauri.<platform>.conf.json` and are held to by `test/bundle-icons.test.ts`.
    expect(config.bundle.active).toBe(true);
  });
});

describe("the window is unadorned", () => {
  it("is transparent outside the mascot's own bounds", () => {
    expect(theWindow().transparent).toBe(true);
  });

  it("carries no title bar and no border", () => {
    expect(theWindow().decorations).toBe(false);
  });

  it("is absent from the taskbar", () => {
    expect(theWindow().skipTaskbar).toBe(true);
  });

  it("is never resized to a request", () => {
    // The requested size is a suggestion the platform may decline, and does. The
    // surface handles whatever it is handed; nothing here corrects it, because
    // correcting a viewport is how a mascot ends up cropped or letterboxed.
    expect(theWindow().resizable).toBe(false);
    expect(mainCode(), "the shell never resizes the window").not.toMatch(/set_size|set_size_logical/);
  });
});

describe("an ambient window never takes focus", () => {
  it("is created without the keyboard", () => {
    // The request. It is a request and not a fact: whether a platform honours it
    // is a property of the platform, and the next two tests are what would notice.
    expect(theWindow().focus).toBe(false);
  });

  it("also gives the keyboard up at start-up, so nothing hands it back later", () => {
    // `focus: false` covers the window *appearing*. This covers the compositor
    // offering it to the user afterwards, which is the other half of the same
    // requirement and the half a persistent surface actually fails.
    expect(mainCode()).toMatch(/set_focusable\(false\)/);
  });

  it("reports a failure to prevent focus rather than raising it", () => {
    // A platform that will not honour the request is a platform limitation, and a
    // shell that exits over it is a shell that does not run at all. What it must
    // not do is swallow the failure either — "reported" is the requirement, and a
    // silently discarded `Err` would leave the user with no way to know an ambient
    // surface is about to interrupt them.
    const body = mainCode();
    const asked = body.slice(body.lastIndexOf("if let", body.indexOf("set_focusable(false)")));

    expect(asked).toMatch(/if let Err\(error\) = window\.set_focusable\(false\)/);
    expect(asked.slice(0, 400)).toMatch(/report\(/);
    expect(asked.slice(0, 400)).not.toMatch(/panic!|expect\(|unwrap\(\)/);
  });

  it("asks for the keyboard only on the one path a decision needs it", () => {
    // `focus_window` is the only place `set_focus` appears, and the only thing
    // that calls it is `surfaceVisibility`'s `takesFocus`. So an ambient surface
    // has no path to the keyboard at all, which is a stronger claim than "it
    // usually does not take it".
    const body = mainCode();
    expect([...body.matchAll(/set_focus\(\)/g)]).toHaveLength(1);
    expect(body).toMatch(/fn focus_window/);
  });

  it("checks afterwards whether the window took the keyboard anyway", () => {
    // The read-back. Without it the requirement is a request and nothing more,
    // and a platform that ignores it — which GNOME Wayland does, per
    // `docs/platform-findings.md` — would look identical to one that obeyed.
    expect(mainCode()).toMatch(/is_focused\(\)/);
    // Read back from a thread rather than from `setup`, because `setup` runs
    // before the event loop pumps and would answer for a window that had not been
    // given a chance to exist.
    expect(mainCode()).toMatch(/thread::spawn/);
  });
});

describe("the window is shown only when it has something to say", () => {
  it("is created hidden", () => {
    // A window created visible flashes on every start, including the majority of
    // starts where nothing is blocked and it should never appear at all.
    expect(theWindow().visible).toBe(false);
  });

  it("is never shown by the host without being asked", () => {
    // The declaration above is the request; this is the check that nothing in the
    // host shows it on its own initiative. `set_window_visible` is the only way
    // it becomes visible, and only the document calls it.
    const body = mainCode();
    expect(body).not.toMatch(/\.show\(\)\s*;/);
    expect(body).toMatch(/window\.show\(\)/);
  });
});

describe("the window is built from the declaration rather than beside it", () => {
  it("declares itself as built by the host, in two steps, so the report can be measured first", () => {
    // `create: false` is what puts the window in our hands at all. Tauri creating
    // it itself would leave nothing to measure between the window appearing and
    // the document loading, and the capability report is read off this window —
    // a style bit on the real `HWND` on Windows, a level on the real `NSWindow` on
    // macOS.
    //
    // So the window is built first and the webview is attached to it afterwards,
    // which is the only ordering in which the report is both the platform's own
    // answer and present for the document's first render. One
    // `WebviewWindowBuilder::build()` cannot do both: it attaches the
    // initialisation script before any window exists to ask.
    expect(theWindow().create).toBe(false);
    expect(mainCode()).toMatch(/WindowBuilder::from_config/);
    expect(mainCode()).toMatch(/add_child\(/);
    expect(mainCode()).toMatch(/WebviewBuilder::from_config/);
  });

  it("names the window rather than indexing the list", () => {
    // A second window added later has to fail here rather than quietly becoming
    // something the user can see.
    expect(mainCode()).toMatch(/get_webview_window\(COMPANION\)/);
  });

  it("embeds the directory the shell's build actually writes", () => {
    const vite = readFileSync(join(ROOT, "shell/vite.config.ts"), "utf8");

    expect(config.build.frontendDist).toBe("../dist");
    expect(vite).toMatch(/outDir[\s\S]*?dist/);
  });
});
