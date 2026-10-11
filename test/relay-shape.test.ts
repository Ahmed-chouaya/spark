import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The relay is a pipe, and that is enforced against its source rather than its
 * behaviour.
 *
 * The host's event names have to become the canonical vocabulary somewhere, and
 * the somewhere is `src/state-selection/adapters/claude-code.ts` — written,
 * tested, and the only place that knows what a Claude Code hook is. If the relay
 * also translated, that vocabulary would exist twice: once where it is
 * exercised, and once where nothing runs it.
 *
 * A behaviour test cannot catch that. A relay that parsed the payload and
 * emitted canonical events would still deliver a working session to a companion
 * that understood both shapes — so every functional test here would pass, and
 * the second implementation would be invisible until the two disagreed about an
 * event neither had been written for yet.
 *
 * So this reads the program instead. The property is a property of its *shape*,
 * and shape is what a source check can actually see.
 */

/** Every `.rs` file that makes up the relay. */
const relaySources = (): { name: string; code: string }[] =>
  readdirSync(join(import.meta.dirname, "../relay/src"), { encoding: "utf8" })
    .filter((path) => path.endsWith(".rs"))
    .map((path) => ({
      name: path,
      code: readFileSync(join(import.meta.dirname, "../relay/src", path), "utf8"),
    }));

/**
 * The source with comments removed.
 *
 * The relay's prose argues at length for why it translates nothing and why it
 * never waits, and it names the host's vocabulary while doing so. Stripping
 * comments is what lets the argument be as long as it needs to be without the
 * check reading it as a violation — the same approach `selection-source.test.ts`
 * takes for the same reason.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/**
 * The host's event vocabulary, as identifiers or as string literals.
 *
 * Kept as the whole vocabulary rather than a watchlist: a per-event branch
 * someone adds later will name one of these, and a check that only forbids the
 * ones somebody remembered would let the next one through.
 */
const HOST_VOCABULARY = [
  "hook_event_name",
  "session_id",
  "notification_type",
  "tool_use_id",
  "tool_input",
  "tool_response",
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "permission_prompt",
  "elicitation_dialog",
  "idle_prompt",
];

/** The canonical vocabulary it would be translated into. */
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

describe("the relay interprets nothing", () => {
  it("names no event of the host's own, as an identifier or a literal", () => {
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      for (const term of HOST_VOCABULARY) {
        expect(body, `${name} names the host's "${term}"`).not.toContain(term);
      }
    }
  });

  it("names no canonical event either, so there is no mapping to do", () => {
    // Either direction of the vocabulary is evidence of interpretation. A relay
    // that merely re-labelled `SessionStart` as `session-started` would be
    // translating, which is the thing being ruled out.
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      for (const term of CANONICAL_VOCABULARY) {
        expect(body, `${name} names the canonical "${term}"`).not.toContain(term);
      }
    }
  });

  it("carries the payload as opaque bytes", () => {
    const main = relaySources().find((source) => source.name === "main.rs");
    expect(main).toBeDefined();

    const body = code(main!.code);
    // No JSON, no deserialisation, no field access: the payload is `Vec<u8>`
    // from standard input to `write_all`, and there is nothing in between that
    // knows what it contains.
    expect(body).not.toMatch(/serde_json|serde::|from_str|to_string|nth\(|\.get\(/);
    expect(body).toMatch(/write_all\(payload\)/);
  });

  it("names no host agent, so a second one cannot route through it", () => {
    // Supporting a second host agent has to be one adapter in
    // `src/state-selection/adapters` and nothing anywhere else. A relay that
    // knew the difference between hosts would need a branch for each, and the
    // branch would have to know the vocabulary the adapter is for.
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      for (const term of ["claude", "Claude", "agent", "hook", "Session"]) {
        expect(body, `${name} mentions "${term}"`).not.toMatch(new RegExp(term));
      }
    }
  });
});

describe("the relay never waits, and says so where an editor will read it", () => {
  it("contains no wait, no retry and no timeout", () => {
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      // The whole fail-open property is that there is no branch in which "the
      // companion did not answer" can become "the host agent failed". A read
      // after the write, a retry, or a timeout would each reintroduce one.
      for (const term of [
        "sleep",
        "read_to_string",
        "read_line",
        "BufReader",
        "timeout",
        "retry",
        "Duration",
        "Instant",
        "spawn",
      ]) {
        expect(body, `${name} waits via "${term}"`).not.toContain(term);
      }
    }
  });

  it("exits successfully on every path, including every failure", () => {
    const main = relaySources().find((source) => source.name === "main.rs");
    const body = code(main!.code);

    // One exit, one code, at the end of `main` — not a failure branch that
    // returns early and a success branch that does not.
    expect([...body.matchAll(/process::exit\((\d+)\)/g)].map((match) => match[1])).toEqual([
      "0",
    ]);
    expect(body).not.toMatch(/exit\(1\)|exit\(2\)|panic!/);
  });

  it("states both claims in the source, for the next person who edits it", () => {
    const main = readFileSync(
      join(import.meta.dirname, "../relay/src/main.rs"),
      "utf8"
    );

    // Not a claim in a changelog or a README nobody opens before touching a
    // file: the reasoning is in the file, at the top, where an editor meets it
    // before deciding what to change.
    expect(main).toMatch(/translates nothing/i);
    expect(main).toMatch(/never waits/i);
    // And each claim says why, because "it doesn't" is not an argument.
    expect(main).toMatch(/would exist twice[\s\S]*nothing runs it/i);
    expect(main).toMatch(/no branch[\s\S]*?already exited/i);
  });
});