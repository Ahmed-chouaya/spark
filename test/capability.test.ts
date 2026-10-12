import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOST_WINDOW_KEY,
  SURFACE_PLACEMENTS,
  UNKNOWN_HOST_WINDOW,
  canHoldPersistentSurface,
  readHostWindow,
} from "../src/escalation/capability";
import type { HostWindow, SurfacePlacement } from "../src/escalation/capability";

/**
 * Platform capability detection.
 *
 * ## What the question is now, and why it is not a smaller question
 *
 * The old probe asked one question and sent it to three platforms: did the
 * compositor grant `zwlr_layer_shell_v1` to this window's surface? That is the
 * right question for a Wayland compositor and no question at all for Windows or
 * macOS, neither of which has a compositor or grants protocols. The empty answer
 * it produced everywhere was true, and the inference drawn from it was the bug.
 *
 * So each platform is asked something it can answer about itself, and the report
 * names which mechanism was consulted alongside what it answered. Two properties
 * follow and are the reason the report is not just a boolean:
 *
 * - **A reader can check the answer.** `{ placement: "windows-topmost", held:
 *   true }` says which question produced it. A boolean says nothing about where
 *   it came from, and a report carrying only `true` is indistinguishable from a
 *   host echoing back its own request.
 * - **"No" and "could not ask" stay apart.** Both select escalate-only, but they
 *   are different facts and a reader debugging a machine needs to tell them
 *   apart. Only the escalate-only behaviour is allowed to be shared.
 *
 * The decision itself is a pure function of the report. Everything below is
 * about that function, and about the module refusing to consult anything the
 * platform did not state.
 */

const MODULE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/escalation/capability.ts"
);

const PLACEMENTS_MODULE = join(dirname(fileURLToPath(import.meta.url)), "../src/escalation/placements.ts");

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * The prose, laid flat.
 *
 * A doc comment is hard-wrapped and every line is prefixed with `*`, so a phrase
 * that reads as one sentence in the file is three lines with asterisks between
 * the words. Asserting on that text without flattening it first produces a test
 * that fails when somebody rewraps a paragraph, which is a test about
 * formatting rather than about the claim — and a test that fails for the wrong
 * reason is one a person learns to rewrap around.
 */
const prose = (source: string): string =>
  source
    .replace(/\/\*\*?/g, " ")
    .replace(/\*\//g, " ")
    .replace(/^\s*\*[ \t]?/gm, " ")
    .replace(/\s+/g, " ")
    .trim();

const source = readFileSync(MODULE, "utf8");

/** A host that reports exactly this: the mechanism it asked about, and the answer. */
const host = (placement: SurfacePlacement, held: boolean): HostWindow => ({ placement, held });

describe("the mechanism is named, because the answer is only auditable with it", () => {
  it("names every question this document accepts, and no others", () => {
    expect([...SURFACE_PLACEMENTS]).toEqual([
      "wayland-layer",
      "windows-topmost",
      "macos-level",
      "unknown",
    ]);
  });

  it("gives each platform a question it can answer about itself", () => {
    // The three named mechanisms are three different kinds of thing being asked
    // about — a compositor's grants, a window's extended style, a window's level
    // — and none of them is "which operating system is this". A name that could
    // be read as an OS would be the proxy this module exists to stop using.
    for (const placement of SURFACE_PLACEMENTS) {
      expect(placement).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }

    expect(prose(source)).toMatch(/is not a question Windows or macOS can answer/i);
  });

  it("keeps the vocabulary in one place rather than inlining the strings", () => {
    // A mechanism name written twice is two spellings waiting to drift. The
    // decision module must not carry its own copy of the vocabulary, which is
    // the whole reason `placements.ts` exists.
    const placements = code(readFileSync(PLACEMENTS_MODULE, "utf8"));
    // The decision module's own body, with comments gone: the names are allowed
    // in its note, where they are quoted as examples of what a report looks
    // like, and nowhere else.

    for (const placement of SURFACE_PLACEMENTS) {
      expect(code(source), placement).not.toContain(`"${placement}"`);
      expect(placements, placement).toContain(`"${placement}"`);
    }
  });
});

describe("every non-affirmative answer is escalate-only", () => {
  it("treats a platform that said no as unable, whichever platform it was", () => {
    for (const placement of SURFACE_PLACEMENTS) {
      expect(canHoldPersistentSurface(host(placement, false)), placement).toBe(false);
    }
  });

  it("treats an absent host as unable rather than guessing", () => {
    // The safe direction, and it is the direction every non-answer goes.
    expect(canHoldPersistentSurface(null)).toBe(false);
  });

  it("treats a host that could ask nothing as unable, whatever it claims to hold", () => {
    // A host that could not ask anything has not been told yes by anybody, so an
    // affirmative beside `unknown` is the host asserting rather than the platform
    // answering. This is the one place a reported boolean is not taken at its
    // word, and it is the failure direction applied one step further.
    expect(canHoldPersistentSurface(host("unknown", true))).toBe(false);
    expect(canHoldPersistentSurface(UNKNOWN_HOST_WINDOW)).toBe(false);
  });

  it("reports a platform that did hold the surface as persistent", () => {
    for (const placement of SURFACE_PLACEMENTS) {
      if (placement === "unknown") continue;
      expect(canHoldPersistentSurface(host(placement, true)), placement).toBe(true);
    }
  });

  it("decides the same way for every platform that said yes, which is what one build needs", () => {
    // One function, three mechanisms, one answer. Nothing here is selected at
    // build time or on an operating-system name: the only inputs are the
    // mechanism that was asked about and what it answered.
    const answers = SURFACE_PLACEMENTS.filter((p) => p !== "unknown").map((p) =>
      canHoldPersistentSurface(host(p, true))
    );

    expect(answers).toEqual([true, true, true]);
  });
});

describe("the failure direction, which is the property most worth holding", () => {
  it("routes every non-affirmative answer to the same behaviour", () => {
    // Stated as a property over the whole space rather than as one example,
    // because the shape of the bug this fixes was an *empty* answer being read
    // as a meaning. Anything that is not a stated yes must be the same answer.
    const outcomes = [
      canHoldPersistentSurface(null),
      canHoldPersistentSurface(host("wayland-layer", false)),
      canHoldPersistentSurface(host("windows-topmost", false)),
      canHoldPersistentSurface(host("macos-level", false)),
      canHoldPersistentSurface(host("unknown", false)),
      canHoldPersistentSurface(host("unknown", true)),
    ];

    expect(outcomes).toEqual([false, false, false, false, false, false]);
  });

  it("does not let an unknown mechanism be read as a yes", () => {
    // The refusal is what keeps an unrecognised mechanism from being treated as
    // an affirmative by accident: `readHostWindow` returns null for it, and null
    // is escalate-only. Without the refusal, a mechanism name from a newer shell
    // reaching an older document would be a value this build cannot audit.
    expect(canHoldPersistentSurface(readHostWindow({ [HOST_WINDOW_KEY]: { placement: "beos-layer", held: true } }))).toBe(
      false
    );
  });
});

describe("'no' and 'could not ask' stay distinguishable", () => {
  it("reads the two as different reports, though both escalate", () => {
    // The audit trail is the whole reason `placement` is in the report. A reader
    // looking at a machine that will not float needs to tell "the platform said
    // no" from "there was no platform to ask", and that difference is exactly
    // what collapses if the report is reduced to a boolean.
    const saidNo = readHostWindow({ [HOST_WINDOW_KEY]: { placement: "wayland-layer", held: false } });
    const couldNotAsk = readHostWindow({ [HOST_WINDOW_KEY]: { placement: "unknown", held: false } });

    expect(saidNo).toEqual({ placement: "wayland-layer", held: false });
    expect(couldNotAsk).toEqual({ placement: "unknown", held: false });
    expect(saidNo).not.toEqual(couldNotAsk);
    expect(canHoldPersistentSurface(saidNo)).toBe(false);
    expect(canHoldPersistentSurface(couldNotAsk)).toBe(false);
  });

  it("distinguishes no host at all from a host that reported unable", () => {
    // `null` is the browser: there is no host behind this document. That is a
    // different fact again from a host that answered, and conflating the two
    // would hide a shell that failed to publish from one that published a
    // working measurement.
    const absent = readHostWindow({});
    const reported = readHostWindow({ [HOST_WINDOW_KEY]: UNKNOWN_HOST_WINDOW });

    expect(absent).toBeNull();
    expect(reported).toEqual({ placement: "unknown", held: false });
  });
});

describe("a report naming no platform is an answer, not an error", () => {
  it("reads a plain browser document as unable to hold a persistent surface", () => {
    // The browser case, and it must land somewhere sensible rather than
    // throwing: a document in a tab has no surface of its own, so "cannot hold
    // one" is correct there and is the behaviour that works everywhere.
    expect(readHostWindow()).toBeNull();
    expect(canHoldPersistentSurface()).toBe(false);
  });

  it("accepts a report of 'no platform asked' as an answer rather than refusing it", () => {
    // A refusal here would be worse than the answer: `readHostWindow` returning
    // null would lose the difference between a shell that measured and found
    // nothing, and a shell that never published anything.
    expect(readHostWindow({ [HOST_WINDOW_KEY]: UNKNOWN_HOST_WINDOW })).toEqual(UNKNOWN_HOST_WINDOW);
  });
});

describe("the same build yields both behaviours", () => {
  it("answers differently for two hosts, with no platform switch between them", () => {
    const persistent = canHoldPersistentSurface(host("windows-topmost", true));
    const transient = canHoldPersistentSurface(host("wayland-layer", false));

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
  it("reads the mechanism and the answer the host published", () => {
    const scope = { [HOST_WINDOW_KEY]: { placement: "windows-topmost", held: true } };

    expect(readHostWindow(scope)).toEqual({ placement: "windows-topmost", held: true });
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
      { placement: 7, held: true },
      { placement: "wayland-layer", held: "true" },
      { placement: "wayland-layer" },
      { held: true },
      { nope: true },
    ]) {
      expect(readHostWindow({ [HOST_WINDOW_KEY]: malformed })).toBeNull();
    }
    expect(readHostWindow(null)).toBeNull();
    expect(readHostWindow(undefined)).toBeNull();
    expect(readHostWindow("not a scope")).toBeNull();
  });

  it("refuses a report naming a mechanism it has never heard of", () => {
    // Forward compatibility is not the same as trust. A mechanism name from a
    // newer shell means this document cannot check what was asked, and a value
    // it cannot audit is not a value it will act on.
    expect(readHostWindow({ [HOST_WINDOW_KEY]: { placement: "wayland-layer-v2", held: true } })).toBeNull();
    expect(readHostWindow({ [HOST_WINDOW_KEY]: { placement: "", held: true } })).toBeNull();
  });

  it("ignores extra fields rather than failing on them", () => {
    // A host is allowed to publish more than this document reads. Refusing the
    // whole report over an unknown field would make adding one a breaking
    // change for every document that has not been rebuilt.
    const scope = { [HOST_WINDOW_KEY]: { placement: "wayland-layer", held: false, extra: "ignored" } };

    expect(readHostWindow(scope)).toEqual({ placement: "wayland-layer", held: false });
  });

  it("finds no host in this environment, so the default is the escalate-only behaviour", () => {
    // Nothing in this repository's own documents publishes a report, so on a
    // plain page there is no host to read and the surface cannot claim to float.
    expect(readHostWindow()).toBeNull();
    expect(canHoldPersistentSurface()).toBe(false);
  });
});

describe("the module documents what it measures and why", () => {
  it("says each platform is asked about itself, rather than one question for all", () => {
    expect(prose(source)).toMatch(/each platform is asked/i);
  });

  it("states that the previous question was meaningless on two of three platforms", () => {
    expect(prose(source)).toMatch(/not a question Windows or macOS can answer/i);
  });

  it("states why a write-echo is not evidence", () => {
    // The trap this change exists to close: an `is_*` accessor returning true
    // after a `set_*(true)` looks exactly like verification from the outside.
    const flat = prose(source);
    expect(flat).toMatch(/write-echo is worse than no answer/i);
    expect(flat).toMatch(/is_\*/);
  });

  it("states the failure direction rather than leaving it to be discovered", () => {
    expect(prose(source)).toMatch(/failure direction/i);
    expect(source).toMatch(/escalate-only/);
  });

  it("states that the published value may only be something the platform stated", () => {
    expect(prose(source)).toMatch(/may only ever be something the platform itself states/i);
  });
});