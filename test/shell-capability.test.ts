import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOST_WINDOW_KEY,
  LAYER_SHELL,
  canHoldPersistentSurface,
  readHostWindow,
} from "../src/escalation/capability";

/**
 * What the platform granted, published where the surface reads it.
 *
 * ## The template is the contract, so it is run rather than read
 *
 * `shell/src-tauri/src/publish.js` is the only copy of the assignment in this
 * repository: `shell/src-tauri/src/capability.rs` embeds it with
 * `include_str!`, and nothing in TypeScript re-declares it. So these tests take
 * that file, do the substitution the Rust side does, and execute the result in a
 * context that has no page in it — which is exactly the situation the
 * initialisation script is for: it has to publish before any of the document's own
 * JavaScript exists to observe the order.
 *
 * ## The property that matters
 *
 * The surface decides whether it can be a persistent companion from one protocol
 * name, and the whole design turns on the difference between that name being
 * *granted* and being *asked for*. A host that reported its own request would
 * produce a surface that believes it is floating on a compositor that never
 * agreed — which looks like the product working, on a machine where it is not.
 *
 * So the failure direction is chosen rather than incidental: an empty list, an
 * absent list and a list of other protocols all read the same way, and that way
 * is correct on every platform. The opposite mistake is unreachable here, and the
 * tests below are what make it unreachable rather than merely unlikely.
 */

const ROOT = join(import.meta.dirname, "..");
const TEMPLATE = readFileSync(join(ROOT, "shell/src-tauri/src/publish.js"), "utf8");
const PLACEHOLDER = "/*__SPARK_PROTOCOLS__*/";

/** The Rust source, with comments removed so prose cannot satisfy a check. */
const rustOf = (file: string): string =>
  readFileSync(join(ROOT, "shell/src-tauri/src", file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");

/**
 * Run the publishing script with `granted` substituted in, and hand back the
 * scope it produced.
 *
 * A fresh context per run, with nothing in it but the globals JavaScript starts
 * with. That is the point: there is no page here, so nothing can have published
 * anything first.
 */
const publishedScope = (granted: readonly string[]): Record<string, unknown> => {
  const scope: Record<string, unknown> = {};
  createContext(scope);

  runInContext(TEMPLATE.replace(PLACEHOLDER, JSON.stringify(granted)), scope);
  return scope;
};

/** The scripts must be valid on their own, too — it is committed as source. */
const TEMPLATE_ALONE = /^\s*\/\/[^\n]*\n\s*\/\/[^\n]*(\n\s*\/\/[^\n]*)*\n/g;

describe("the report is published before the document's own JavaScript", () => {
  it("assigns the key the surface reads, and nothing else onto it", () => {
    const scope = publishedScope([LAYER_SHELL]);

    expect(Object.keys(scope)).toContain(HOST_WINDOW_KEY);
    expect(readHostWindow(scope)).toEqual({ protocols: [LAYER_SHELL] });
  });

  it("is JavaScript on its own, so the committed file is runnable", () => {
    // The placeholder is a comment rather than a bare token precisely so this
    // holds: a template that only parsed once substituted would be a file that
    // looks like a script and is not one.
    expect(() => publishedScope([])).not.toThrow();
    expect(TEMPLATE.replace(TEMPLATE_ALONE, "").trim()).toMatch(/^\(function/);
  });

  it("leaves no placeholder behind, because an unsubstituted one is a syntax error", () => {
    for (const granted of [[], [LAYER_SHELL], ["wl_compositor", "xdg_toplevel"]]) {
      const script = TEMPLATE.replace(PLACEHOLDER, JSON.stringify(granted));
      expect(script, granted.join()).not.toContain(PLACEHOLDER);
    }
  });

  it("is attached as an initialisation script, not written into a document that has none", () => {
    // The timing is the whole problem. `setup` runs before the webview document
    // exists, so a write from there is a write into nothing, and a write after
    // the window is built is a write that lands after the surface's first render
    // — which is the render that reads it.
    const main = rustOf("main.rs");

    expect(main).toMatch(/initialization_script\(published\)/);
    expect(main).not.toMatch(/\.eval\(|eval\(published\)/);
  });
});

describe("the published report is what the platform granted, not what was asked for", () => {
  it("reports a granted protocol", () => {
    expect(canHoldPersistentSurface(readHostWindow(publishedScope([LAYER_SHELL])))).toBe(true);
  });

  it("reports nothing for an empty grant", () => {
    expect(readHostWindow(publishedScope([]))).toEqual({ protocols: [] });
    expect(canHoldPersistentSurface(readHostWindow(publishedScope([])))).toBe(false);
  });

  it("reports nothing for a list naming only other protocols", () => {
    const scope = publishedScope(["wl_compositor", "xdg_wm_base", "wl_seat"]);

    expect(canHoldPersistentSurface(readHostWindow(scope))).toBe(false);
  });

  it("cannot be produced for a host reporting a layer it was not granted", () => {
    // The one failure `capability.ts`'s note warns about, stated as a property
    // over every grant that lacks the protocol rather than as one example: there
    // is no grant without `zwlr_layer_shell_v1` in it from which the surface can
    // read "yes", however the host composed the report.
    const withoutIt = [[], ["wl_compositor"], ["wl_seat", "xdg_wm_base"], ["zwlr_layer_shell_v2"]];

    for (const granted of withoutIt) {
      expect(canHoldPersistentSurface(readHostWindow(publishedScope(granted))), granted.join()).toBe(
        false
      );
    }
  });

  it("reads an absent report as the same answer as an empty one", () => {
    // A document with no host behind it is the browser case, and it must land
    // somewhere sensible rather than throwing: "cannot hold a persistent surface"
    // is correct there, and is the behaviour that works everywhere.
    expect(canHoldPersistentSurface(readHostWindow({}))).toBe(false);
    expect(canHoldPersistentSurface(readHostWindow(publishedScope([])))).toBe(false);
  });
});

describe("the Rust side derives the report from the read-back", () => {
  it("asks the platform first and publishes what came back", () => {
    const capability = rustOf("capability.rs");
    const main = rustOf("main.rs");

    // The two ends of the bug, in the order they would appear. A report built
    // from `REQUESTED` instead of `granted_protocols()` passes every test above,
    // because every test above starts from a grant.
    expect(capability).toMatch(/fn granted_protocols\(\) -> Vec<String>/);
    expect(main).toMatch(/capability_report\(\s*&capability::REQUESTED,\s*&capability::granted_protocols\(\)/);

    // And the filter is on the grant, with the request used only to subtract.
    const report = capability.slice(capability.indexOf("pub fn capability_report"));
    expect(report.slice(0, 900)).toMatch(/granted[\s\S]*?asked\.contains/);
  });

  it("publishes through one template, and the template is the one under test", () => {
    // A second copy of the assignment in Rust would be a second claim about what
    // the document reads during its first render, and nothing would check the two
    // agreed.
    //
    // Read raw rather than comment-stripped: the placeholder is a string literal
    // that *contains* a comment, and a stripper that meant to be helpful would
    // eat the very token this is looking for.
    const capability = readFileSync(join(ROOT, "shell/src-tauri/src/capability.rs"), "utf8");

    expect(capability).toMatch(/include_str!\("\.\/publish\.js"\)/);
    expect(capability).toContain(PLACEHOLDER);
  });

  it("names the protocol the surface checks for", () => {
    expect(rustOf("capability.rs")).toContain(`"${LAYER_SHELL}"`);
  });
});
