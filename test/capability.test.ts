import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_WINDOW_KEY,
  LAYER_SHELL,
  canHoldPersistentSurface,
  readHostWindow,
} from "../src/escalation/capability";

/**
 * Platform capability detection.
 *
 * The question is narrow and mechanical: can this platform keep a window above
 * other windows that are not focused? Everything here is about the answer being
 * derived from what the compositor actually granted, rather than from a name.
 */

const MODULE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/escalation/capability.ts"
);

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const source = readFileSync(MODULE, "utf8");

/** A host that granted exactly the protocols named. */
const host = (...protocols: string[]) => ({ protocols });

describe("capability is the layer-shell protocol, not the operating system", () => {
  it("names the protocol that decides it", () => {
    expect(LAYER_SHELL).toBe("zwlr_layer_shell_v1");
  });

  it("reports a persistent surface only where that protocol was granted", () => {
    expect(canHoldPersistentSurface(host(LAYER_SHELL))).toBe(true);
  });

  it("reports no persistent surface where it was not", () => {
    expect(canHoldPersistentSurface(host())).toBe(false);
    expect(canHoldPersistentSurface(host("wl_compositor", "xdg_toplevel"))).toBe(false);
  });

  it("treats an unknown host as unable rather than guessing", () => {
    // The safe direction. A host that cannot answer gets the behaviour that
    // works everywhere instead of one resting on a guess being right.
    expect(canHoldPersistentSurface(null)).toBe(false);
  });

  it("does not care which other protocols were granted", () => {
    const withExtras = host("wl_compositor", "xdg_toplevel", LAYER_SHELL, "zwlr_export_dmabuf_v1");

    expect(canHoldPersistentSurface(withExtras)).toBe(true);
  });
});

describe("the same build yields both behaviours", () => {
  it("answers differently for two hosts, with no platform switch between them", () => {
    // One function, two hosts, two answers. Nothing here is selected at build
    // time or on an operating-system name: the only input is the protocol list.
    const persistent = canHoldPersistentSurface(host(LAYER_SHELL));
    const transient = canHoldPersistentSurface(host());

    expect(persistent).toBe(true);
    expect(transient).toBe(false);
  });

  it("carries no operating-system, desktop or build-flag branch", () => {
    const body = code(source);

    // Every one of these is a proxy for the capability rather than the
    // capability, and each is wrong somewhere. The probe must not consult any.
    for (const term of [
      "linux",
      "Linux",
      "gnome",
      "GNOME",
      "kde",
      "KDE",
      "mac",
      "darwin",
      "win32",
      "process.platform",
      "userAgent",
      "navigator",
      "isMac",
      "IS_WINDOWS",
      "__DEV__",
      "import.meta.env",
    ]) {
      expect(body, term).not.toContain(term);
    }
  });
});

describe("reading the host's report", () => {
  it("reads the protocol list the host published", () => {
    const scope = { [HOST_WINDOW_KEY]: { protocols: [LAYER_SHELL] } };

    expect(readHostWindow(scope)).toEqual({ protocols: [LAYER_SHELL] });
    expect(canHoldPersistentSurface(readHostWindow(scope))).toBe(true);
  });

  it("reports nothing for a scope with no host in it", () => {
    expect(readHostWindow({})).toBeNull();
    expect(readHostWindow({ [HOST_WINDOW_KEY]: undefined })).toBeNull();
  });

  it("reports nothing rather than throwing on a malformed report", () => {
    // A host handing back nonsense must not take the companion down with it:
    // the consequence of an unreadable report is the behaviour that works
    // everywhere, which is what `null` means.
    for (const malformed of [
      null,
      undefined,
      "a string",
      42,
      { protocols: "not an array" },
      { protocols: 7 },
      { nope: true },
    ]) {
      expect(readHostWindow({ [HOST_WINDOW_KEY]: malformed })).toBeNull();
      expect(readHostWindow(null)).toBeNull();
      expect(readHostWindow(undefined)).toBeNull();
      expect(readHostWindow("not a scope")).toBeNull();
    }
  });

  it("drops the non-strings from an otherwise readable report", () => {
    expect(readHostWindow({ [HOST_WINDOW_KEY]: { protocols: [LAYER_SHELL, 7, null] } })).toEqual({
      protocols: [LAYER_SHELL],
    });
  });

  it("finds no host in this environment, so the default is the escalate-only behaviour", () => {
    // The ambient default. Nothing in this repository publishes a protocol
    // report, so on a plain document there is no host to read and the surface
    // cannot claim to hold a layer.
    expect(readHostWindow()).toBeNull();
    expect(canHoldPersistentSurface()).toBe(false);
  });
});

describe("the module documents what it measures and why", () => {
  it("explains that layer-shell is the deciding factor", () => {
    expect(source).toMatch(/layer-shell protocol is the deciding factor/i);
  });

  it("names the protocol in the note rather than an operating system", () => {
    expect(source).toContain(LAYER_SHELL);
    // The note has to name what was measured. Naming a platform instead would
    // document the proxy this module exists to stop using.
    expect(source).toMatch(/the protocol list is the fact itself/i);
  });

  it("states what the probe actually measures", () => {
    expect(source).toMatch(/What the probe actually measures/i);
    expect(source).toMatch(/protocols the compositor granted this window's surface/i);
  });

  it("states the failure direction rather than leaving it to be discovered", () => {
    expect(source).toMatch(/failure direction is chosen, not incidental/i);
  });
});