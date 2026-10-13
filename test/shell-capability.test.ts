import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOST_WINDOW_KEY,
  SURFACE_PLACEMENTS,
  UNKNOWN_HOST_WINDOW,
  canHoldPersistentSurface,
  readHostWindow,
} from "../src/escalation/capability";
import type { HostWindow } from "../src/escalation/capability";

/**
 * What the platform said, published where the surface reads it.
 *
 * ## The template is the contract, so it is run rather than read
 *
 * `shell/src-tauri/src/publish.js` is the only copy of the assignment in this
 * repository: `shell/src-tauri/src/capability.rs` embeds it with `include_str!`,
 * and nothing in TypeScript re-declares it. So these tests take that file, do
 * the substitution the Rust side does, and execute the result in a context that
 * has no page in it — which is exactly the situation the initialisation script
 * is for: it has to publish before any of the document's own JavaScript exists
 * to observe the order.
 *
 * ## The properties that matter, in the order they matter
 *
 * **The answer comes from the platform.** Tauri offers `is_always_on_top()`, and
 * reading it is the shape of verification this project keeps asking for. Across
 * tao 0.37.1 it returns an `AtomicBool` the host set on Linux, a flag the host
 * set on Windows, and a genuine query on macOS. On two of three platforms it is
 * a write-echo: it returns what was requested, not what the platform did, which
 * `docs/platform-findings.md` already records happening on GNOME. A write-echo
 * is worse than no answer, because a method named `is_*` returning `true` after
 * a `set_*(true)` looks exactly like evidence and survives review. The guard
 * below fails the build if the Rust reaches for it at all, on any platform,
 * including the one where it happens to be correct.
 *
 * **Each platform is asked about itself.** The previous probe asked all three
 * the same question — did the compositor grant `zwlr_layer_shell_v1` — and read
 * the empty answer on every one of them as "no platform can float". The empty
 * answer was true; the inference was a category error, and it is what made the
 * shell report itself incapable on Windows 11.
 *
 * **Every non-answer is escalate-only.** Including "could not ask", which is the
 * answer the old code reached by accident on two platforms and did not know it
 * had reached.
 */

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = readFileSync(join(ROOT, "shell/src-tauri/src/publish.js"), "utf8");
const PLACEMENT_PLACEHOLDER = "__SPARK_PLACEMENT__";
const HELD_PLACEHOLDER = "__SPARK_HELD__";

/** The Rust source, with comments removed so prose cannot satisfy a check. */
const rustOf = (file: string): string =>
  readFileSync(join(ROOT, "shell/src-tauri/src", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/**
 * The Rust's `initialization_script`, run on an answer the test chose.
 *
 * Hand-copied rather than shared with the Rust: a test that reimplemented the
 * substitution would pass when both sides drifted, and the drift is the whole
 * failure. It is small enough to be checked against the template on its own —
 * see "the placeholders are the ones the Rust replaces".
 */
const publishedScope = (report: HostWindow): Record<string, unknown> => {
  const scope: Record<string, unknown> = {};
  createContext(scope);

  const script = TEMPLATE.replace(PLACEMENT_PLACEHOLDER, JSON.stringify(report.placement)).replace(
    HELD_PLACEHOLDER,
    String(report.held)
  );
  runInContext(script, scope);
  return scope;
};

/** What the published report reads as, for a report the test chose. */
const published = (placement: HostWindow["placement"], held: boolean): HostWindow | null =>
  readHostWindow(publishedScope({ placement, held }));

/** The scripts must be valid on their own, too — it is committed as source. */
const TEMPLATE_ALONE = /^\s*\/\/[^\n]*\n\s*\/\/[^\n]*(\n\s*\/\/[^\n]*)*\n/g;

describe("the report is published before the document's own JavaScript", () => {
  it("assigns the key the surface reads, and nothing else onto it", () => {
    const scope = publishedScope({ placement: "windows-topmost", held: true });

    expect(Object.keys(scope)).toEqual([HOST_WINDOW_KEY]);
    expect(readHostWindow(scope)).toEqual({ placement: "windows-topmost", held: true });
  });

  it("refuses to publish anything unsubstituted, rather than publishing a wrong one", () => {
    // The tokens are bare identifiers, so the committed file *parses* and then
    // throws — which is the honest failure. A comment placeholder with a default
    // beside it was tried and is worse than useless: `/*token*/ "unknown"`
    // substitutes to `"windows-topmost""unknown"`, which parses, is the wrong
    // value, and fails only on the run nobody looks at. See `publish.js`.
    const scope: Record<string, unknown> = {};
    createContext(scope);

    expect(() => runInContext(TEMPLATE, scope)).toThrow(/__SPARK_PLACEMENT__/);
    expect(scope[HOST_WINDOW_KEY]).toBeUndefined();
  });

  it("is a script, so the committed file is recognisably one", () => {
    expect(TEMPLATE.replace(TEMPLATE_ALONE, "").trim()).toMatch(/^\(function/);
    expect(() => publishedScope(UNKNOWN_HOST_WINDOW)).not.toThrow();
  });

  it("leaves no placeholder behind, because an unsubstituted one is a syntax error", () => {
    for (const report of [
      UNKNOWN_HOST_WINDOW,
      { placement: "wayland-layer", held: false },
      { placement: "windows-topmost", held: true },
      { placement: "macos-level", held: false },
    ] as const) {
      const script = TEMPLATE.replace(PLACEMENT_PLACEHOLDER, `"${report.placement}"`).replace(
        HELD_PLACEHOLDER,
        String(report.held)
      );
      expect(script, report.placement).not.toContain(PLACEMENT_PLACEHOLDER);
      expect(script, report.placement).not.toContain(HELD_PLACEHOLDER);
    }
  });

  it("publishes `held` as a boolean, not a string that says true", () => {
    // The document refuses a report whose `held` is not a boolean, so a quoted
    // "true" would produce a report that reads as no host at all — safe, and
    // silently wrong on a platform that could float.
    expect(published("windows-topmost", true)).toEqual({ placement: "windows-topmost", held: true });
    expect(published("windows-topmost", false)).toEqual({ placement: "windows-topmost", held: false });
  });

  it("is attached as an initialisation script, not written into a document that has none", () => {
    // The timing is the whole problem, and it is a different problem now that
    // the answer comes from the window. The window has to exist before it can be
    // asked, so the window is built first and the webview is attached to it
    // afterwards — otherwise `eval` would run against whatever document happens
    // to be current, which before the page has loaded is not the page.
    const main = rustOf("main.rs");

    expect(main).toMatch(/WindowBuilder::from_config\(app\.handle\(\), &declared\)\?\.build\(\)/);
    expect(main).toMatch(/add_child\(/);
    // `new`, not `from_config` — the latter takes no URL, so a webview built
    // with it never loads a document and the script never runs at all. See
    // `test/shell-window.test.ts` for the measurement that found it.
    expect(main).toMatch(/WebviewBuilder::new\(/);
    expect(main).toMatch(/initialization_script\(published\)/);
    expect(main).not.toMatch(/\.eval\(|eval\(published\)/);
  });

  it("measures the window before it asks, so the answer is the window's own", () => {
    // The order is the whole of the correctness claim on Windows and macOS: the
    // report is a function of the window that exists, not of the declaration
    // that describes it. Reversing these two lines would produce a report built
    // from `tauri.conf.json`, which is the host's own request.
    const main = rustOf("main.rs");
    const measured = main.indexOf("capability_report(&window)");
    const attached = main.indexOf("add_child(");

    expect(measured).toBeGreaterThan(-1);
    expect(attached).toBeGreaterThan(-1);
    expect(measured, "the window is measured before the webview is attached").toBeLessThan(attached);
  });
});

describe("the report names the mechanism, so the answer can be checked", () => {
  it("round-trips every mechanism the host may publish", () => {
    for (const placement of SURFACE_PLACEMENTS) {
      expect(published(placement, true), placement).toEqual({ placement, held: true });
      expect(published(placement, false), placement).toEqual({ placement, held: false });
    }
  });

  it("publishes nothing at all as a readable 'could not ask', rather than as a missing key", () => {
    // The shape is fixed whatever the measurement was. A report that omits the
    // key is one `readHostWindow` rejects outright, and the difference between
    // "the platform said no" and "no host answered" is the difference between
    // escalate-only and a surface that cannot read itself.
    expect(published("unknown", false)).toEqual({ placement: "unknown", held: false });
    expect(Object.keys(publishedScope(UNKNOWN_HOST_WINDOW))).toEqual([HOST_WINDOW_KEY]);
  });

  it("carries no protocol names, because two of the three platforms have none", () => {
    // A report of `["windows-topmost"]` in a list of protocols would be a lie
    // about the kind of thing in it, and the next reader would reasonably ask
    // what protocol that is.
    for (const placement of SURFACE_PLACEMENTS) {
      const report = published(placement, true);
      expect(Object.keys(report!).sort()).toEqual(["held", "placement"]);
    }
  });
});

describe("the report is what the platform said, not what the host asked for", () => {
  it("routes every answer through the surface's own decision", () => {
    // The report and the decision are checked together, because a report that
    // the surface cannot read is a report that never reaches a decision, and a
    // decision that does not come from this report is a second opinion.
    expect(canHoldPersistentSurface(published("windows-topmost", true))).toBe(true);
    expect(canHoldPersistentSurface(published("wayland-layer", false))).toBe(false);
    expect(canHoldPersistentSurface(published("macos-level", true))).toBe(true);
    expect(canHoldPersistentSurface(published("unknown", false))).toBe(false);
  });

  it("makes the same build behave differently on two platforms, with no build flag", () => {
    const windows = canHoldPersistentSurface(published("windows-topmost", true));
    const gnome = canHoldPersistentSurface(published("wayland-layer", false));

    expect(windows).toBe(true);
    expect(gnome).toBe(false);
  });

  it("routes every non-affirmative answer to escalate-only, through the real template", () => {
    // The property this whole change exists to hold, stated over the space rather
    // than as one example — because the bug it fixes *was* an empty answer being
    // read as a meaning, and a guard that only covers the case you remembered is
    // not a guard.
    const outcomes = [
      ...SURFACE_PLACEMENTS.map((placement) =>
        canHoldPersistentSurface(published(placement, false))
      ),
      canHoldPersistentSurface(published("unknown", true)),
      canHoldPersistentSurface(readHostWindow({})),
    ];

    expect(outcomes).toEqual([false, false, false, false, false, false]);
  });
});

describe("the Rust side derives the report from the platform, not from the host", () => {
  it("asks the platform's own question on each platform", () => {
    const capability = rustOf("capability.rs");

    // Each of the three is a question about a different thing, and none of them
    // is "which operating system is this". A branch on `cfg!(target_os)` that
    // picked the *answer* rather than the *question* would be the proxy this
    // exists to stop using.
    expect(capability).toMatch(/GetWindowLongW/);
    expect(capability).toMatch(/GWL_EXSTYLE/);
    expect(capability).toMatch(/WS_EX_TOPMOST/);
    expect(capability).toMatch(/NSFloatingWindowLevel/);
    expect(capability).toMatch(/level\(\)/);
  });

  it("reads the Windows style bit from the handle, not from a flag the host set", () => {
    const capability = rustOf("capability.rs");
    const windows = capability.slice(capability.indexOf("fn windows_topmost"));

    // `window.hwnd()` is the runtime's handle for a real window. Anything else —
    // a window id, a config value, a field of our own — would be asking about
    // our request rather than about the platform.
    expect(windows).toMatch(/window\.hwnd\(\)/);
    expect(windows).not.toMatch(/is_always_on_top|always_on_top/);
  });

  it("reads the macOS level from the window, not from the runtime's accessor", () => {
    const capability = rustOf("capability.rs");
    const macos = capability.slice(capability.indexOf("fn macos_level"));

    expect(macos).toMatch(/window\.ns_window\(\)/);
    expect(macos).not.toMatch(/is_always_on_top/);
  });

  it("does not consult the Wayland protocol anywhere it is not the mechanism", () => {
    // The layer protocol names the Wayland question and nothing else. Carrying it
    // onto a platform with no protocols is what made the old question meaningless.
    const capability = rustOf("capability.rs");
    // Boundaries are function names, not doc comments: `rustOf` has already
    // stripped the comments, so a doc comment is not there to find. Slicing to
    // a marker that is missing silently yields "the rest of the file", which
    // would make this test fail on the test module's own assertions instead of
    // on the thing it is about.
    const body = (from: string, to: string) =>
      capability.slice(capability.indexOf(from), capability.indexOf(to));

    const windows = body("fn windows_topmost", "fn macos_level");
    const macos = body("fn macos_level", "pub fn capability_report");

    expect(windows).not.toMatch(/layer_shell|LAYER_SHELL/);
    expect(macos).not.toMatch(/layer_shell|LAYER_SHELL/);
    expect(capability).toMatch(/zwlr_layer_shell_v1/);
  });

  it("publishes through one template, and the template is the one under test", () => {
    // A second copy of the assignment in Rust would be a second claim about what
    // the document reads during its first render, and nothing would check the two
    // agreed.
    //
    // Read raw rather than comment-stripped: the placeholders are string
    // literals that *contain* comments, and a stripper that meant to be helpful
    // would eat the very tokens this is looking for.
    const capability = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8");

    expect(capability).toMatch(/include_str!\("\.\/publish\.js"\)/);
    expect(capability).toContain(PLACEMENT_PLACEHOLDER);
    expect(capability).toContain(HELD_PLACEHOLDER);
  });

  it("names the mechanisms the surface checks for", () => {
    // Spelled once each side and compared here, so a change to either has to
    // change both. A report built against a differently spelled mechanism is a
    // report that silently says no.
    const capability = rustOf("capability.rs");

    for (const placement of SURFACE_PLACEMENTS) {
      expect(capability, placement).toContain(`"${placement}"`);
    }
  });

  it("declares the crates it reads the platform through, rather than inheriting them", () => {
    // `windows-sys` and `objc2-app-kit` are both already in the lock file as
    // dependencies of Tauri, so either would work today. A direct use of a
    // transitive crate is one `cargo update` from vanishing, which would turn
    // "read the platform's own state" into a build failure at the least obvious
    // moment.
    const manifest = readFileSync(join(ROOT, "shell/src-tauri/Cargo.toml"), "utf8");

    const section = (name: string) =>
      manifest.slice(manifest.indexOf(`[target.'${name}'.dependencies]`));

    expect(section("cfg(windows)")).toMatch(/windows-sys/);
    expect(section('cfg(target_os = "macos")')).toMatch(/objc2-app-kit/);
  });
});

describe("the guard worth the most attention", () => {
  it("fails if the Rust side reaches for the write-echo at all", () => {
    // Verified against tao 0.37.1's own source:
    //
    //   Linux     is_always_on_top() -> self.is_always_on_top.load(Acquire)
    //   Windows   is_always_on_top() -> window_flags.contains(ALWAYS_ON_TOP)
    //   macOS     is_always_on_top() -> ns_window.level() == kCGFloatingWindowLevelKey
    //
    // The first two return what the host requested. The third happens to be a
    // genuine query, and is still forbidden — see the module note in
    // `capability.rs`. A guard with an exception is a guard with a hole in it,
    // and the hole is one line long.
    // Comment-stripped, so the module note explaining *why* it is banned does not
    // itself trip the ban. The explanation is the point; the call is not.
    for (const file of ["capability.rs", "main.rs", "channel.rs"]) {
      expect(rustOf(file), `${file} calls is_always_on_top`).not.toMatch(/is_always_on_top\s*\(/);
    }
  });

  it("says in the source why, for the next person who finds the accessor first", () => {
    // Not a comment nobody reads before reaching for the obvious API: the
    // reasoning is at the top of the file, where an editor meets it.
    const capability = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8");
    const flat = capability.replace(/\s+/g, " ");

    expect(flat).toMatch(/write-echo/i);
    expect(flat).toMatch(/is_always_on_top/);
    expect(flat).toMatch(/looks like evidence/i);
  });
});

describe("the Rust side states what it measures and why", () => {
  it("names the question each platform is asked", () => {
    const capability = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8");

    expect(capability).toMatch(/did the compositor bind a layer surface/i);
    expect(capability).toMatch(/topmost extended style bit set on the real/i);
    expect(capability).toMatch(/window's level a floating level/i);
  });

  it("states the failure direction rather than leaving it to be discovered", () => {
    const flat = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8").replace(
      /\s+/g,
      " "
    );

    expect(flat).toMatch(/failure direction/i);
    expect(flat).toMatch(/escalate-only/);
  });

  it("states that an absent handle is 'could not ask' rather than 'no'", () => {
    // The two answers have the same consequence and different causes, and the
    // difference is what lets somebody debug a machine that will not float.
    const capability = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8");

    expect(capability).toMatch(/unaskable/i);
  });
});