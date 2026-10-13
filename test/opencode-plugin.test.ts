import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The OpenCode plugin is a pipe, and that is checked against its source.
 *
 * The property is about the program's *shape*: it forwards the host's events and
 * nothing else. A behaviour test cannot see that — a plugin that translated
 * events would deliver working payloads to a companion that understood both
 * shapes, so every functional check would pass and the second implementation
 * would be invisible until the two disagreed about an event neither had been
 * written for.
 *
 * So this reads the file. The same approach `relay-shape.test.ts` and
 * `ask-shape.test.ts` take, for the same reason, and the relay's module note
 * makes the argument at length: behaviour tests pass just as happily with
 * interpretation bolted on to the front.
 */

const PLUGIN = join(import.meta.dirname, "../shell/src-tauri/plugins/spark.js");

const source = (): string => readFileSync(PLUGIN, "utf8");

/** The source with comments removed, so prose naming a term is not a violation. */
const code = (value: string): string =>
  value.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** The canonical vocabulary the companion owns, from the adapter that defines it. */
const CANONICAL_VOCABULARY = [
  "session-started",
  "prompt-submitted",
  "tool-activity",
  "authorization-requested",
  "agent-question",
  "time-passed",
  "failed",
  "completed",
];

/** The mascot's own states. Never this file's business. */
const MASCOT_STATES = [
  "idle",
  "thinking",
  "working",
  "focused",
  "listening",
  "alert",
  "success",
  "tired",
  "needsYou",
];

describe("the plugin forwards and does not interpret", () => {
  it("names no canonical event, so there is no second mapping", () => {
    for (const term of CANONICAL_VOCABULARY) {
      expect(code(source()), `the plugin names the canonical "${term}"`).not.toContain(term);
    }
  });

  it("names no mascot state, so it cannot be shaping what is on screen", () => {
    for (const state of MASCOT_STATES) {
      expect(code(source()), `the plugin names the state "${state}"`).not.toContain(state);
    }
  });

  it("carries the host's event whole rather than picking it apart", () => {
    // The payload is `{ agent, event }` and the event goes in untouched. A
    // plugin that rebuilt it field by field would know what it meant.
    const body = code(source());
    expect(body).toMatch(/JSON\.stringify\(\{\s*agent:\s*AGENT,\s*event\s*\}\)/);
  });

  it("names no field of the companion's session shape", () => {
    // `sessionID` belongs to the *host's* payload and is the plugin's to carry;
    // `requestedAt`, `operation` and `lastActiveAt` are the companion's, and a
    // plugin that reached for them would be deciding something about the block
    // rather than reporting it.
    const body = code(source());
    for (const term of ["requestedAt", "lastActiveAt", "ambient", "escalates"]) {
      expect(body, `the plugin names "${term}"`).not.toContain(term);
    }
  });
});

describe("the plugin cannot make the host wait", () => {
  it("does not await anything on the host's critical path", () => {
    // The whole of `relay/`'s property, restated where it would otherwise be
    // broken: a hook that can delay a tool call because a window is slow is a
    // dependency on the host's critical path.
    const body = code(source());

    expect(body, "awaits the relay").not.toMatch(/await\s+(forward|spawn)/);
    expect(body, "holds a promise open").not.toMatch(/await new Promise/);
  });

  it("cannot throw into the host", () => {
    const body = code(source());
    expect(body, "throws").not.toMatch(/throw /);
    // Every exit from `forward` is a silent one, because a plugin that raised
    // would take the host down with it.
    expect(body, "lets a spawn failure escape").toMatch(/child\.on\("error"/);
  });

  it("stops on the host's teardown rather than outliving it", () => {
    // A plugin holding an open subscription keeps a process alive that was
    // trying to shut down.
    expect(code(source())).toMatch(/return \(\) => controller\.abort\(\)/);
  });
});

describe("the plugin says which agent it speaks for, and nothing more", () => {
  it("writes an agent on every payload", () => {
    // Routing, not interpretation: the companion needs to know whose event it is
    // holding, and this is the only party that knows.
    const body = code(source());
    expect(body).toMatch(/const AGENT = "opencode"/);
    expect(body).toMatch(/agent:\s*AGENT/);
  });

  it("names no other host, so it is not routing between them", () => {
    const body = code(source());
    expect(body).not.toContain("claude-code");
  });
});

describe("what the plugin deliberately does not do", () => {
  it("does not answer a permission request", () => {
    // The host has a hook for it (`ctx.permission.hook`, answering
    // allow/deny/ask) and it is not wired, because it never fired in any run made
    // while writing this file. A plugin that answered a permission request the
    // companion never asked about would be the worst thing in this repository:
    // an agent's tool call decided by a decoration.
    const body = code(source());
    expect(body, "registers a permission hook").not.toMatch(/permission/);
    expect(body, "reaches for allow or deny").not.toMatch(/["'](?:allow|deny)["']/);
  });
});
