import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MASCOT_STATES } from "../src/components/mascot";
import { decide, supersede } from "../src/escalation/pending";
import { openChannel, openReplyChannel } from "../src/relay/channel";

/**
 * The waiting program, read rather than run.
 *
 * ## Why these are the tests that matter here
 *
 * Every property below is a property of the program's *shape*, and no
 * behavioural test can see it.
 *
 * The clearest example is the one this file exists for: a program that read
 * `tool_use_id` out of the payload and used it as its request identifier would
 * pass every test in `test/ask.test.ts`. The round trip still works — the
 * identifier is still a string, still matches the answer, still differs between
 * two invocations. What has changed is that the host's vocabulary now exists in
 * a second program, in a language nothing else in this repository interprets a
 * host in, and the only place it would ever be noticed is when the two halves
 * disagree about a field nobody wrote the second one for yet.
 *
 * That is the same argument `test/relay-shape.test.ts` makes for the relay, one
 * program over, and it is why the two files are twins rather than one file with
 * two sections: the relay's property is "never waits" and this one's is "knows
 * nothing", and both are enforced the same way — read the source, because shape
 * is what a source check can see.
 *
 * ## The relay's own guarantees, checked from here
 *
 * The last section is about a *different* program. Weakening "the relay never
 * blocks the host" would be the easiest way to make this change smaller — a
 * `--wait` flag instead of a second crate — and it would be invisible, because
 * the default path would keep behaving exactly as it does now. So the property
 * is checked here, by the file whose subject is the thing that would erode it.
 */

/** Every `.rs` file that makes up the waiting program. */
const askSources = (): { name: string; code: string }[] =>
  readdirSync(join(import.meta.dirname, "../ask/src"), { encoding: "utf8" })
    .filter((path) => path.endsWith(".rs"))
    .map((path) => ({
      name: path,
      code: readFileSync(join(import.meta.dirname, "../ask/src", path), "utf8"),
    }));

/** Every `.rs` file that makes up the relay, for the checks about the relay. */
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
 * Both programs argue at length for what they are and are not, and they name the
 * very vocabulary they are forbidden from carrying while doing so. Stripping
 * comments is what lets the argument be as long as it needs to be without the
 * check reading it as a violation — the same approach `relay-shape.test.ts`
 * takes, for the same reason.
 */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const main = (): string => {
  const found = askSources().find((source) => source.name === "main.rs");
  if (!found) throw new Error("ask/src/main.rs is missing");
  return found.code;
};

/**
 * The host's event vocabulary, as identifiers or as string literals.
 *
 * The whole vocabulary rather than a watchlist: a per-event branch someone adds
 * later will name one of these, and a check that only forbade the ones somebody
 * remembered would let the next one through.
 */
const HOST_VOCABULARY = [
  "hook_event_name",
  "session_id",
  "notification_type",
  "tool_use_id",
  "tool_name",
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

/** What the surface offers, and the two answers. Not this program's to know. */
const SURFACE_VOCABULARY = [
  "allow",
  "deny",
  "ask",
  "defer",
  "permissionDecision",
  "hookSpecificOutput",
  "hookEventName",
  "pending",
  "escalat",
];

/**
 * How a payload became an answer, without naming either.
 *
 * `spark-ask` is a program's own name and asking is what it does, so the two
 * words this file forbids as *the surface's vocabulary* — `ask` as an answer and
 * `ask` as a verb — cannot be told apart by spelling. The one line that means
 * "asks" rather than "is asked" is excluded here rather than the whole word,
 * because a guard that fails on correct code gets deleted.
 */
const ALLOWED_IN_ASK = /\bask(s|ed|ing)?\s+the\s+companion|\bask_the_companion\b/g;

describe("the waiting program knows nothing", () => {
  it("names no event of the host's own, as an identifier or a literal", () => {
    for (const { name, code: source } of askSources()) {
      const body = code(source);
      for (const term of HOST_VOCABULARY) {
        expect(body, `${name} names the host's "${term}"`).not.toContain(term);
      }
    }
  });

  it("names no canonical event either, so there is no mapping to do", () => {
    // Either direction of the vocabulary is evidence of interpretation. A
    // program that merely re-labelled `PreToolUse` as `tool-activity` would be
    // translating, which is the thing being ruled out.
    for (const { name, code: source } of askSources()) {
      const body = code(source);
      for (const term of CANONICAL_VOCABULARY) {
        expect(body, `${name} names the canonical "${term}"`).not.toContain(term);
      }
    }
  });

  it("names no mascot state, so it cannot be shaping what the user is shown", () => {
    // Enumerated from the mascot's own vocabulary rather than written out here,
    // so a tenth state is covered the moment it exists and a stale copy of the
    // list cannot quietly shrink the check — the same approach
    // `test/shell-shape.test.ts` takes.
    for (const { name, code: source } of askSources()) {
      const body = code(source);
      for (const state of MASCOT_STATES) {
        expect(body, `${name} names the state "${state}"`).not.toMatch(new RegExp(`\\b${state}\\b`));
      }
    }
  });

  it("names nothing of the surface's own vocabulary", () => {
    // The two answers, and the vocabulary of a request being offered. This is
    // the direction the relay's check does not go, and it is the one that
    // matters most here: a program that knew the word `deny` could one day
    // print it, and the whole design rests on there being no code in this
    // program in which "the user did not answer" becomes "the tool is refused".
    for (const { name, code: source } of askSources()) {
      const body = code(source);
      for (const term of SURFACE_VOCABULARY) {
        expect(body.replace(ALLOWED_IN_ASK, " "), `${name} names "${term}"`).not.toMatch(
          new RegExp(term, "i")
        );
      }
    }
  });

  it("carries the payload and the answer as opaque bytes", () => {
    const body = code(main());

    // No JSON, no deserialisation, no field access: the payload is `Vec<u8>`
    // from standard input to `write_all`, and the answer is `Vec<u8>` from
    // `read_exact` to `write_all`. Neither end knows what is inside, which is
    // what makes it impossible for this program to invent a decision.
    expect(body).not.toMatch(/serde_json|serde::|from_str|to_string|nth\(|\.get\(|from_utf8_lossy/);
    expect(body).toMatch(/write_all\(payload\)/);
    expect(body).toMatch(/read_exact\(&mut decision\)/);
  });

  it("names no host agent, so a second one cannot route through it", () => {
    // Supporting a second host agent has to be one adapter in
    // `src/state-selection/adapters` and nothing anywhere else. A program that
    // knew the difference between hosts would need a branch for each, and the
    // branch would have to know the vocabulary the adapter is for.
    for (const { name, code: source } of askSources()) {
      const body = code(source);
      for (const term of ["claude", "Claude", "agent", "hook", "Session"]) {
        expect(body, `${name} mentions "${term}"`).not.toMatch(new RegExp(term));
      }
    }
  });
});

describe("its identifier is made here, not read from the host", () => {
  it("generates one from this process, rather than taking one from the payload", () => {
    const body = code(main());

    // The two halves of the claim, and both are needed. A program that
    // *subtracted* the host's identifier would pass the first; a program that
    // read a field it happened to have invented would pass the second.
    expect(body).toMatch(/fn request_id\(\) -> String/);
    expect(body).toMatch(/std::process::id\(\)/);
    // Nothing that could read a named field out of the payload. The payload is
    // moved whole, into the thread, and never indexed.
    expect(body).not.toMatch(/payload\[|payload\.windows|payload\.iter\(\)\.position|split\(/);
  });

  it("uses a form the frame can carry, so an id cannot break its own framing", () => {
    const body = code(main());

    // Hex with a dash between two runs. A newline here would let a generated
    // value end the frame early, which is a vocabulary this program would then
    // have for itself — the thing the module note says it does not have.
    expect(body).toMatch(/format!\("\{:x\}-\{:x\}"/);
  });

  it("confirms the answer names the request before printing it", () => {
    const body = code(main());

    // An answer that arrives under somebody else's identifier is a decision
    // about something else. Comparing is the whole of what this program does
    // with the identifier: it is never read, only matched.
    expect(body).toMatch(/if reply_id != id \{/);
    expect(body).toMatch(/return Answer::Nothing;/);
  });
});

describe("the wait is bounded by this program and not by the companion", () => {
  it("has exactly one bounded wait, and it is the one that can end things", () => {
    const body = code(main());

    // One `recv_timeout`. An unbounded `recv` anywhere — a second wait, a retry
    // loop, a `select!` with no arm for the deadline — is the failure this is
    // looking for, and counting the bounded call rather than the words around it
    // is what makes a new one visible.
    expect([...body.matchAll(/recv_timeout\(/g)]).toHaveLength(1);
    expect(body).not.toMatch(/\.recv\(\)/);
    expect(body).not.toMatch(/sleep|select!/);

    // And no loop that waits. A read loop is fine — one byte at a time is how a
    // line is read without a buffer — but a loop that *waits* is a bound nobody
    // owns, so every loop in this program is checked for a wait inside it rather
    // than loops being forbidden outright.
    for (const [block] of body.matchAll(/(?:loop|while)\s*(?:\{|\w*\s*\{)[\s\S]*?\n\}/g)) {
      expect(block, `a loop waits: ${block.slice(0, 60)}`).not.toMatch(/recv|sleep|read_exact/);
    }
  });

  it("names one deadline, and uses it", () => {
    const body = code(main());

    // A bound is a single number in a single place. Two constants, or a number
    // typed into the wait, is a bound with two answers.
    expect([...body.matchAll(/const DEADLINE:/g)]).toHaveLength(1);
    expect(body).toMatch(/recv_timeout\(DEADLINE\)/);
  });

  it("reads the answer on another thread, so the deadline is not waiting for a read", () => {
    const body = code(main());

    // A single `read_exact` on the main thread would block it, and the deadline
    // would be a number in a comment rather than a bound in fact.
    expect(body).toMatch(/std::thread::spawn/);
    expect([...body.matchAll(/read_exact\(/g)]).toHaveLength(1);
  });

  it("refuses an answer it could not have written whole", () => {
    const body = code(main());

    // Half a decision is not a decision. A host handed half an object is owed
    // the same silence as one handed none, so the bound is checked before the
    // read and an over-long length is refused rather than truncated.
    expect(body).toMatch(/length == 0 \|\| length > MAX_REPLY_BYTES/);
    expect(body).toMatch(/return Answer::Nothing;/);
  });
});

describe("every exit is a success", () => {
  it("has one exit, and it is zero", () => {
    const body = code(main());

    // One exit, one code, at the end of `main` — not a failure branch that
    // returns early and a success branch that does not. An exit status a host
    // reads as a failed hook is itself a way of harming the user's agent.
    expect([...body.matchAll(/process::exit\((\d+)\)/g)].map((match) => match[1])).toEqual(["0"]);
    expect(body).not.toMatch(/exit\(1\)|exit\(2\)|panic!/);
  });

  it("prints on exactly one path, and it is the one with a decision in hand", () => {
    const body = code(main());

    // One call site. A second one — a farewell line, a warning, a "no answer"
    // message — is a byte a host could read as an answer, and this program's
    // silence is the whole fail-open property.
    expect([...body.matchAll(/print\(/g)]).toHaveLength(2); // the fn, and its one call
    expect(body).toMatch(/if let Answer::Decision\(decision\) = answer \{/);
  });

  it("writes the decision's own bytes and adds nothing of its own", () => {
    const body = code(main());

    // `write_all` of the buffer and nothing else. No framing, no prefix, no
    // newline of its own: a byte this program added on the way out would be a
    // byte the companion's host did not agree to read.
    expect(body).toMatch(/stdout\.write_all\(decision\)/);
    expect(body).not.toMatch(/writeln!|println!|eprintln!/);
  });
});

describe("the relay is untouched by a second program existing", () => {
  it("still contains no wait, no retry and no timeout", () => {
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      // The whole fail-open property is that there is no branch in which "the
      // companion did not answer" can become "the host agent failed". A read
      // after the write, a retry, or a timeout would each reintroduce one — and
      // this is the file that has to be checked *because* a second program now
      // exists that could have been a flag on this one.
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

  it("has no mode flag that would turn it into the waiting program", () => {
    // The obvious way to make this change smaller was `spark-relay --wait`, and
    // it would have worked: the default path behaves identically, so every test
    // in `test/relay.test.ts` would have kept passing. That is exactly why it is
    // refused — the guarantee erodes without anything failing.
    for (const { name, code: source } of relaySources()) {
      const body = code(source);
      for (const term of ["--wait", "std::env::args", "flag", "mode"]) {
        expect(body, `${name} grows "${term}"`).not.toMatch(new RegExp(term, "i"));
      }
    }
  });

  it("reaches no other program, so the two cannot grow into one", () => {
    for (const { name, code: source } of relaySources()) {
      // Two crates with a shared module is one crate. If the relay ever
      // imports anything from `ask/`, the argument for two programs has already
      // been given up and nothing will say so.
      expect(code(source), `${name} mentions ask`).not.toMatch(/ask|spark_ask|decision/i);
    }

    // The reverse, checked only against imports rather than prose: the waiting
    // program's module note talks at length about the relay, because refusing
    // the obvious alternative is most of what it has to explain.
    for (const { name, code: source } of askSources()) {
      const imports = [...source.matchAll(/^\s*(?:pub\s+)?mod\s+(\w+)/gm)].map((m) => m[1]);
      expect(imports.filter((module) => /relay/i.test(module!)), `${name} imports the relay`)
        .toEqual([]);
    }
  });

  it("still declares no dependencies, so its own guarantee is unchanged", () => {
    const manifest = readFileSync(join(import.meta.dirname, "../relay/Cargo.toml"), "utf8");

    // Checked because this change added a second crate that could have been a
    // dependency, and "we added a crate so we may depend on it" is not a step
    // this program gets to take.
    expect(manifest).not.toMatch(/spark-ask|ask\s*=/);
  });

  it("reaches the companion at an address the relay does not use", () => {
    // Two programs, two sockets. A single listener would have had to guess which
    // of the two it was talking to by looking at the bytes, and a listener that
    // guesses is the failure `relay/` was created to avoid.
    const relay = code(readFileSync(join(import.meta.dirname, "../relay/src/address.rs"), "utf8"));
    const ask = code(readFileSync(join(import.meta.dirname, "../ask/src/address.rs"), "utf8"));

    expect(relay).toContain("companion.sock");
    expect(ask).toContain("decisions.sock");
  });
});

describe("the channel's reply path is additive", () => {
  const channel = (): string =>
    readFileSync(join(import.meta.dirname, "../src/relay/channel.ts"), "utf8");

  it("keeps the one-way path's own name, signature and callback", () => {
    const source = channel();

    // The boundary this change was most likely to break by accident, and the one
    // that matters: `listen()` moving means the relay's semantics moved with it.
    expect(source).toMatch(/export async function openChannel\(/);
    expect(source).toMatch(/onPayload: PayloadHandler/);
    expect(source).toMatch(/readOnePayload\(socket, options\.onPayload\)/);

    // And `openChannel` reaches nothing of the reply path. "One reader for both"
    // is the simplification that would collapse the two entry points into one,
    // and it is refuted here rather than by reading the whole function: the
    // reply reader's name must not appear between `openChannel` and its closing
    // brace.
    const body = source.slice(source.indexOf("export async function openChannel("));
    const oneWay = body.slice(0, body.indexOf("\n}\n"));
    expect(oneWay).not.toMatch(/readOneRequest|PendingRequestChannel|currentDecisionAddress/);
  });

  it("has a separate entry point for the reply path", () => {
    // An addition, not a mode. `openReplyChannel` cannot reach `openChannel`'s
    // handler and vice versa, so there is no branch in the one-way path that the
    // reply path could switch on.
    expect(channel()).toMatch(/export async function openReplyChannel\(/);
  });

  it("binds the answer to the connection that asked, with no request argument", () => {
    // `reply` closes over the socket and the identifier read from it, so there
    // is no way to answer one request with another request's decision. An
    // argument naming a request would put that burden on every caller, and the
    // whole of this design is that it is not asked of anybody.
    const source = channel();
    expect(source).toMatch(/reply\(decision: Buffer\): boolean/);
    expect(source).toMatch(/function makeRequest\(socket: Socket, id: string, payload: Buffer\)/);
    expect(source).not.toMatch(/reply\(decision: Buffer, /);
  });

  it("refuses an answer larger than a payload, before writing any of it", () => {
    // Half a decision is not a decision, and the check has to be *before* the
    // write rather than after it: bytes already on a connection cannot be
    // un-sent, so a truncation discovered afterwards leaves the host holding
    // half an object.
    //
    // The refusal also has to close the connection. The requester is a program
    // on the host agent's critical path, and leaving it waiting for a reply that
    // has already been refused costs it its whole deadline for an outcome this
    // function knows. Asserted on the order rather than on the text, because
    // "there is a length check somewhere in this function" is not the property —
    // "there is no write before it" is.
    const source = channel();
    const body = source.slice(source.indexOf("function makeRequest("));
    const beforeWrite = body.slice(0, body.indexOf("socket.write("));

    expect(beforeWrite).toMatch(/decision\.length > MAX_PAYLOAD_BYTES/);
    expect(beforeWrite).toMatch(/socket\.end\(\);\s*\n\s*return false;/);
    expect(beforeWrite).not.toMatch(/socket\.write\(/);
  });
});

describe("the rules this program depends on have one implementation", () => {
  it("asks the escalation module for the decision, rather than re-deriving it", () => {
    const runtime = readFileSync(join(import.meta.dirname, "../src/companion/runtime.ts"), "utf8");

    // "A decision applies to one request" is a security boundary. It lives in
    // `src/escalation/pending` and it is *called* here. A second filter-and-forget
    // in the transport would be the same rule twice, and the copy that runs is
    // the copy nothing tested.
    expect(runtime).toMatch(/\bdecide\(/);
    expect(runtime).toMatch(/\bsupersede\(/);
    expect(runtime).toMatch(/\bdismiss\(/);

    // And the rule is present as a function to call, not only as prose.
    expect(typeof decide).toBe("function");
    expect(typeof supersede).toBe("function");
  });

  it("has the one-way path and the reply path as separate exported entry points", () => {
    // Asserted through the module rather than by reading it: these are two
    // exports that exist and have different signatures, which is the property
    // the design rests on.
    expect(typeof openChannel).toBe("function");
    expect(typeof openReplyChannel).toBe("function");
  });
});