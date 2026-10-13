import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { askCommand, binaryName, isNativeBinary } from "../src/relay/binary";
import { currentCompanionAddress, currentDecisionAddress } from "../src/relay/address";
import { openReplyChannel, type CompanionChannel } from "../src/relay/channel";
import { permissionDecision } from "../src/companion/decision";
import { dllNames, foreignImports, installedSystemDlls, linkedFromLdd } from "./support/imports";

/**
 * The waiting program, run as the host agent runs it.
 *
 * Everything here spawns the built binary against a real socket and a real
 * clock. Nothing stubs it and nothing fakes the passage of time, because the two
 * properties this file is about cannot be observed any other way:
 *
 * - **That it prints nothing.** Asserted on the bytes, because "prints nothing"
 *   and "prints something the host will read as no decision" are different
 *   claims, and only the first one is safe. A newline, an empty JSON object and
 *   the word `deny` are all things a host reads as an answer.
 * - **That it stops at its bound.** A mocked timer tests the mock. What has to
 *   be true is that a real process, with a real companion that never answers,
 *   really does exit — and the only assertion that means anything is the one
 *   made with a real `spawnSync` and `process.hrtime`.
 *
 * ## Why these tests own the real address
 *
 * `ask/src/address.rs` derives its address from the user running it and has no
 * option to point it elsewhere — the same refusal `relay/` makes, and for the
 * same reason. So every test in this file shares one address and takes turns,
 * which is also why no other file spawns this binary.
 */

const ASK_DIR = join(import.meta.dirname, "../ask");
const BINARY = askCommand();

beforeAll(() => {
  // Built here so the tests measure the binary rather than a fixture that
  // resembles it. `cargo` is already needed to develop it.
  execFileSync("cargo", ["build", "--release"], { cwd: ASK_DIR, stdio: "pipe" });
}, 180_000);

/* ------------------------------------------------------------------ helpers */

/** One request, as the companion's side of it sees one. */
interface Received {
  readonly id: string;
  readonly payload: Buffer;
}

/** What a companion in this file did with a request. */
type Behaviour = (request: Received, connection: Socket) => void;

const servers: Server[] = [];
const opened: CompanionChannel[] = [];

/** Every companion listening right now, closed. They share one derived address. */
const closeCompanions = async (): Promise<void> => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((done) => server.close(() => done())))
  );
  await Promise.all(opened.splice(0).map((channel) => channel.close().catch(() => {})));
};

afterEach(closeCompanions);

/**
 * A companion listening at this user's real decision address.
 *
 * `behaviour` is what it does with a request, and the default is to answer
 * immediately with an allow. Tests that are about something else pass their own,
 * including "never answer at all", which is the one the deadline exists for.
 *
 * One at a time: the address is derived from the user and there is no option to
 * point the program elsewhere, so a second listener in the same test would be
 * fighting the first for it.
 */
async function companion(behaviour: Behaviour = allowNow): Promise<Server> {
  const address = currentDecisionAddress();
  if (!address) throw new Error("this machine has no readable identity to derive an address from");

  const server = createServer((socket) => {
    // The same frame `openReplyChannel` reads, written by hand here rather than
    // through it: this file is checking the *program*, so it should not be
    // agreeing with it by construction through the module it is being tested
    // against.
    let received = Buffer.alloc(0);

    // Typed rather than annotated: a `data` handler's chunk is whatever the
    // stream produced, which may be a string if an encoding was ever set on it.
    // `Buffer.concat` needs bytes, and the assertion that matters is on those
    // bytes, so the conversion happens where the frame is assembled.
    socket.on("data", (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      received = Buffer.concat([received, bytes]);

      const first = received.indexOf(0x0a);
      const second = received.indexOf(0x0a, first + 1);
      if (first < 0 || second < 0) return;

      const id = received.subarray(0, first).toString("utf8");
      const length = Number(received.subarray(first + 1, second).toString("utf8"));
      const body = received.subarray(second + 1);
      if (!Number.isInteger(length) || body.length < length) return;

      behaviour({ id, payload: Buffer.from(body.subarray(0, length)) }, socket);
    });

    socket.on("error", () => socket.destroy());
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(address, () => done());
  });
  servers.push(server);

  return server;
}

/** Answer at once, the way a companion does when the user answers at once. */
function allowNow(request: Received, connection: Socket): void {
  connection.end(answer(request.id, { permissionDecision: "allow" }));
}

/** The frame the waiting program reads, as the companion writes it. */
function answer(id: string, decision: unknown): Buffer {
  const body = Buffer.from(`${JSON.stringify(decision)}\n`, "utf8");
  return Buffer.concat([Buffer.from(`${id}\n${body.length}\n`, "utf8"), body]);
}

/** Say nothing at all, and keep the connection open. The worst case. */
function neverAnswer(_request: Received, connection: Socket): void {
  connection.on("error", () => connection.destroy());
}

/**
 * Do something that may raise, and report what happened rather than letting it.
 *
 * A late answer to a process that has already exited can reach the operating
 * system as a write to a socket whose peer is gone, and whether that surfaces as
 * a return value or as an error depends on the kernel's timing. Asserting on one
 * of them would be asserting on the timing; this reports both, so the test can
 * say what it actually means.
 */
function attempt(what: () => unknown): { threw: Error | null; returned: unknown } {
  try {
    return { threw: null, returned: what() };
  } catch (thrown) {
    return { threw: thrown as Error, returned: undefined };
  }
}

/** Wait for an event, bounded, so a connection that never ends fails the test. */
function once(emitter: Socket, event: "close"): Promise<void> {
  return new Promise((done) => {
    const timer = setTimeout(done, 5_000);
    emitter.once(event, () => {
      clearTimeout(timer);
      done();
    });
  });
}

/**
 * Run the waiting program, asynchronously.
 *
 * Asynchronous, and that is not a style choice. The companion these tests talk
 * to lives in *this* process, and `spawnSync` blocks this process's event loop
 * while it waits — so a synchronously-spawned program could never be answered
 * by an in-process companion, and every test of the round trip would pass
 * vacuously by falling through to the deadline.
 */
function ask(payload: string, extra: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const started = process.hrtime.bigint();

  return new Promise<{
    status: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    elapsedMs: number;
  }>((done) => {
    const child = spawn(BINARY, [], {
      cwd: extra.cwd ?? process.cwd(),
      env: { ...process.env, ...extra.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status, signal) =>
      done({
        status,
        signal,
        stdout,
        stderr,
        elapsedMs: Number(process.hrtime.bigint() - started) / 1e6,
      })
    );

    // A program that has already given up closes its standard input without
    // reading the rest, and writing to it then is EPIPE. That is the program
    // behaving correctly on the "nothing usable on standard input" path, so it
    // is swallowed here rather than surfaced as an unhandled error that fails
    // whichever test happened to be running.
    child.stdin.on("error", () => {});
    child.stdin.end(payload);
  });
}

/**
 * How long a test that waits out the program's own bound is allowed to take.
 *
 * The program's bound is ten seconds of real wall-clock, and these tests are
 * about the bound, so their timeout is the bound plus room for a loaded machine.
 * A test that asserted the bound with a mock would be asserting the mock.
 */
const THROUGH_A_DEADLINE = 30_000;

/** A payload as the host agent writes one, for a permission request. */
const asking = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "s-1",
    tool_name: "Bash",
    tool_input: { command: "npm publish" },
    ...overrides,
  });

/* ------------------------------------------------------------------- tests */

describe("the two halves derive one address", () => {
  it("the built program reaches the address the TypeScript side derives", async () => {
    // The cross-language half of the address contract, and the reason
    // `src/relay/address.ts` and `ask/src/address.rs` are allowed to be two
    // implementations of one rule: the binary was built by `beforeAll`, this
    // listener is bound at the address TypeScript derives, and the payload
    // arrives. If the two halves disagreed the program would connect to nothing,
    // print nothing, and exit 0 — which looks exactly like working.
    //
    // It lives in this file rather than in `test/decision-address.test.ts`
    // because the derived address is owned by whoever spawns the binary: vitest
    // runs files in parallel, and two listeners on one path take the socket from
    // each other rather than sharing it.
    const arrived = new Promise<Received>((done) => {
      void companion((request, connection) => {
        connection.end(answer(request.id, { permissionDecision: "allow" }));
        done(request);
      });
    });

    expect(BINARY).toContain(join("ask", "target", "release"));
    expect(currentDecisionAddress()).not.toBeNull();
    expect(currentDecisionAddress()).not.toBe(currentCompanionAddress());

    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect((await arrived).payload.toString("utf8")).toBe(asking());
  });

  it("is reached by the production listener, the one with no address given", async () => {
    // The default, not an option. A hook the user installs has no address to pass
    // — the program derives it — so the path that matters is the one where the
    // companion opens its channel with nothing given at all, and this asserts it
    // binds the socket the TypeScript side derives rather than the relay's.
    //
    // It belongs here and not in `test/decision-channel.test.ts` because this file
    // owns the derived address: two files binding one socket does not fail
    // politely, it takes the socket from whichever was listening first.
    //
    // This is the real listener, so the frames on this connection are the real
    // module's, which is the point — the program is being answered by the
    // companion as it ships rather than by a hand-written stand-in.
    //
    // Awaited before the program is spawned rather than raced against it: a
    // listener that is still binding is a connection refused, and a connection
    // refused fails open, so the test would have watched silence and called it a
    // pass.
    let seen: Received | undefined;
    const channel = await openReplyChannel({
      onRequest: (request) => {
        request.reply(permissionDecision("deny"));
        seen = { id: request.id, payload: request.payload };
      },
    });
    opened.push(channel);

    expect(channel.address).toBe(currentDecisionAddress());
    expect(channel.address).not.toBe(currentCompanionAddress());

    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(seen?.payload.toString("utf8")).toBe(asking());
    // The bytes the host would have parsed, produced by the companion as it ships
    // and printed by the program as it ships.
    expect(JSON.parse(run.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Refused in the Spark companion.",
      },
    });
  });
});

describe("the waiting program announces what the host wrote", () => {
  it("delivers the payload unaltered, under an identifier of its own", async () => {
    const arrived = new Promise<Received>((done) => {
      void companion((request, connection) => {
        connection.end(answer(request.id, { permissionDecision: "allow" }));
        done(request);
      });
    });

    const run = await ask(asking());
    const seen = await arrived;

    expect(run.status).toBe(0);
    // Byte for byte. The payload is the host's own, and a program that
    // re-encoded it would be a program that had begun to interpret it.
    expect(seen.payload.toString("utf8")).toBe(asking());
  });

  it("names the request itself, rather than naming the host's own", async () => {
    const arrived = new Promise<Received>((done) => {
      void companion((request, connection) => {
        connection.end(answer(request.id, { permissionDecision: "allow" }));
        done(request);
      });
    });

    const run = await ask(asking({ tool_use_id: "toolu_01ABC" }));
    const seen = await arrived;

    // The host gives every tool call an identifier and it is right there in the
    // payload. Using it would have been the obvious thing and would have put the
    // host's vocabulary in this program — which is the duplication the adapter
    // boundary has spent this whole project preventing, and what
    // `test/ask-shape.test.ts` exists to catch.
    //
    // The generated form is two hex runs and a dash, because the frame separates
    // on a newline and an identifier that could contain one would be able to
    // break its own framing.
    expect(seen.id).not.toContain("toolu_01ABC");
    expect(seen.id).toMatch(/^[0-9a-f]+-[0-9a-f]+$/);
    expect(run.stdout).toContain("permissionDecision");
  });

  it("gives two invocations different identifiers", async () => {
    const ids: string[] = [];
    await companion((request, connection) => {
      ids.push(request.id);
      connection.end(answer(request.id, { permissionDecision: "allow" }));
    });

    await ask(asking());
    await ask(asking());

    // Two requests, two identifiers. A shared one would mean the second answer
    // could be delivered to the first request, which is the one thing the
    // identifier exists to make impossible.
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("a decision reaches the host in the host's own shape", () => {
  it("prints bytes Claude Code's documented PreToolUse shape would parse", async () => {
    // Exactly the documented shape, written here rather than imported, so the
    // test states the contract instead of agreeing with the code that
    // implements it. From `docs/en/hooks`, "PreToolUse decision control": the
    // decision is nested in `hookSpecificOutput`, `hookEventName` is required,
    // and the deprecated top-level `decision` field is not the shape any more.
    await companion((request, connection) => {
      const body = Buffer.from(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: "Refused in the Spark companion.",
          },
        })}\n`,
        "utf8"
      );
      connection.end(Buffer.concat([Buffer.from(`${request.id}\n${body.length}\n`), body]));
    });

    const printed = await ask(asking());

    expect(printed.status).toBe(0);
    expect(printed.stdout).not.toBe("");

    const parsed = JSON.parse(printed.stdout) as {
      hookSpecificOutput: { hookEventName: string; permissionDecision: string; permissionDecisionReason?: string };
    };
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PreToolUse");
    expect(parsed.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe("Refused in the Spark companion.");
    // And nothing outside `hookSpecificOutput`: the deprecated top-level form
    // would still work today and break later.
    expect(Object.keys(parsed)).toEqual(["hookSpecificOutput"]);
  });

  it("passes the answer through byte for byte, having added nothing", async () => {
    // A payload with newlines in it, because a hook payload is JSON and JSON
    // contains them. If anything framed or re-encoded this, it would break.
    const delivered = Buffer.from('{"a":"one\ntwo","b":"three"}\n', "utf8");
    await companion((request, connection) =>
      connection.end(Buffer.concat([Buffer.from(`${request.id}\n${delivered.length}\n`), delivered]))
    );

    const printed = await ask(asking());

    // The exact bytes, not "something equivalent". This program does not know
    // what a decision is, so the only way it can print one is by not touching
    // it.
    expect(Buffer.from(printed.stdout, "utf8")).toEqual(delivered);
  });
});

describe("the exit is always a success, and the silence is always empty", () => {
  it("prints nothing at all when no companion is running", async () => {
    // Nothing is listening, and the socket does not exist at all: the first
    // invocation on a machine where the companion has never run.
    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(run.signal).toBeNull();
    // Empty, not "empty enough". A newline is a byte, and a host parsing output
    // it does not understand falls back — which is safe — while a host handed
    // half an object is not.
    expect(run.stdout).toBe("");
    expect(run.stdout.length).toBe(0);
    expect(run.stderr).toBe("");
  });

  it("returns immediately rather than waiting out a deadline it can see coming", async () => {
    // The timing assertion, not the exit assertion. A companion that is not
    // running is knowable at the first moment, and a program that waited its
    // whole bound before noticing would pass "exits successfully" while making
    // the user's agent stand still for nothing.
    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.elapsedMs).toBeLessThan(2_000);
  });

  it("prints nothing when standard input carries nothing", async () => {
    for (const input of [
      "",
      "   ",
      "not json at all",
      '{"hook_event_name":',
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ padding: "x".repeat(2 << 20) }),
    ]) {
      const run = await ask(input);

      expect(run.status, input.slice(0, 30)).toBe(0);
      expect(run.stdout, input.slice(0, 30)).toBe("");
      expect(run.stderr, input.slice(0, 30)).toBe("");
    }
  });

  it("prints nothing when the exchange fails part way", async () => {
    // The connection is accepted and then closed without an answer. The request
    // was announced, so this is the "the exchange then fails" case, and it is
    // the one where a program could plausibly think it owes the host something.
    await companion((_request, connection) => connection.destroy());

    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toBe("");
  });

  it("prints nothing when the answer names a request it is not for", async () => {
    // The answer comes back under somebody else's identifier. It is a decision,
    // and it is about something else, and printing it would answer this question
    // with a decision made for another one.
    await companion((_request, connection) => connection.end(answer("not-this-one", { deny: true })));

    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  });

  it("prints nothing when the answer is empty, malformed, or oversized", async () => {
    for (const body of [
      Buffer.alloc(0),
      Buffer.from("not a frame"),
      Buffer.from("some-id\nnot-a-number\n{}"),
      // A length past anything this program will accept. Half a decision is not
      // a decision.
      Buffer.from("some-id\n99999999\n{}"),
    ]) {
      // One companion at a time: they share the derived address, and a second
      // listener would fight the first for it rather than test anything.
      await closeCompanions();
      await companion((_request, connection) => connection.end(body));

      const run = await ask(asking());

      expect(run.status, body.toString("utf8").slice(0, 30)).toBe(0);
      expect(run.stdout, body.toString("utf8").slice(0, 30)).toBe("");
    }
  });

  it("prints nothing when the companion never reads what it was given", async () => {
    // The worst case for a program that waited for a reader: a connection that
    // is accepted, held open, and read not at all. The write completes into a
    // buffer nobody will drain, and only the deadline can end this.
    await companion(neverAnswer);

    const run = await ask(asking());

    expect(run.status).toBe(0);
    expect(run.stdout).toBe("");
  }, THROUGH_A_DEADLINE);
});

describe("a timeout is not a decision", () => {
  it("gives no decision at all when the deadline passes", async () => {
    // The load-bearing test in this file, and the reason the deadline is ten
    // seconds rather than "as long as the user takes". A companion that never
    // answers must produce silence, because the two alternatives are not
    // symmetric:
    //
    //   nothing printed -> the host asks the user in its terminal, which is
    //                      exactly what it would do with no companion installed
    //   `deny` printed  -> the tool is refused. The user did not refuse it. We
    //                      did, on their behalf, because they were slow, and it
    //                      is indistinguishable from one they did.
    await companion(neverAnswer);

    const run = await ask(asking());

    expect(run.status).toBe(0);
    // Empty bytes, which is stronger than "not a refusal": it also is not an
    // allow, and it is not an empty decision object.
    expect(run.stdout).toBe("");
    expect(run.stdout).not.toMatch(/deny|allow|permissionDecision|hookSpecificOutput/i);
  }, THROUGH_A_DEADLINE);

  it("ends at its own bound, enforced by this process rather than the companion", async () => {
    await companion(neverAnswer);

    const run = await ask(asking());

    // Not "eventually". The bound is the claim: a wait that ends when the
    // companion decides to end it is a wait with no bound, and the companion is
    // the component with the most ways to hang.
    expect(run.elapsedMs).toBeGreaterThan(9_000);
    expect(run.elapsedMs).toBeLessThan(20_000);
  }, THROUGH_A_DEADLINE);

  it("is over well inside the host's own patience for a hook", async () => {
    // Claude Code's documented default for a command hook is 600 seconds. This
    // is not an argument about that number so much as a check that the bound
    // this program owns is not the one the host was going to impose anyway:
    // if it were, the wait would end because the host gave up, which is the
    // failure mode where the host's failure is blamed on the companion.
    await companion(neverAnswer);

    const run = await ask(asking());

    expect(run.elapsedMs).toBeLessThan(60_000);
  }, THROUGH_A_DEADLINE);

  it("discards an answer that arrives after the deadline", async () => {
    // Held rather than assigned: the assignment happens inside a callback, and
    // a variable the compiler believes is still `null` here narrows to `never`
    // after the `?.` — which would let a type error stand in for the assertion
    // the test exists to make.
    const held: Socket[] = [];
    await companion((_request, connection) => {
      held.push(connection);
    });

    const run = await ask(asking());

    // The request was really announced, and the companion really is holding the
    // connection the answer would have gone back on. Without this, the test would
    // pass on a companion that never saw the request at all.
    expect(held).toHaveLength(1);

    // The answer the user made, arriving after the process that would have read
    // it is gone. It is delivered rather than thrown, so the check is what
    // happened to it rather than that it was convenient to throw.
    const outcome = attempt(() =>
      held[0]!.end(answer("a-late-answer", { permissionDecision: "allow" }))
    );

    expect(run.stdout).toBe("");
    expect(run.status).toBe(0);
    // Provably harmless in both directions: writing to a dead peer raises
    // nothing at the companion — which is on a user's machine, serving somebody
    // else's request in a moment — and the connection ends rather than sitting
    // there holding a decision for a process that is not waiting.
    expect(outcome.threw).toBeNull();
    await once(held[0]!, "close");
    expect(held[0]!.destroyed).toBe(true);
  }, THROUGH_A_DEADLINE);
});

describe("it needs nothing on the machine", () => {
  it("is a program, not a script that needs an interpreter", () => {
    expect(isNativeBinary(readFileSync(BINARY)), "the binary must be a binary").toBe(true);
  });

  it("runs and reaches the companion with no project dependencies present", async () => {
    const arrived = new Promise<Received>((done) => {
      void companion((request, connection) => {
        connection.end(answer(request.id, { permissionDecision: "allow" }));
        done(request);
      });
    });

    // An empty PATH, no NODE_PATH, and `/` as the working directory: nothing
    // above it has a `node_modules`. Whatever this program resolves has to come
    // from the kernel.
    const run = await ask(asking(), {
      cwd: "/",
      env: { PATH: "", NODE_PATH: "", HOME: process.env.HOME ?? "/tmp" },
    });

    expect(run.status, run.stderr).toBe(0);
    expect((await arrived).payload.toString("utf8")).toBe(asking());
    expect(run.stdout).toContain("allow");
  });

  it("links nothing that has to be installed", () => {
    // The property rather than a list of versions: whatever this machine's C
    // runtime happens to be called, the only things linked must be ones the
    // operating system ships. A language runtime, or anything a package manager
    // put there, would mean a machine without project dependencies could not
    // run this — and this one is on the critical path, where a failure to start
    // is felt as the agent breaking.
    const isWindows = process.platform === "win32";
    const linked = isWindows ? dllNames(readFileSync(BINARY)) : linkedFromLdd(BINARY);

    if (linked === null) return;

    expect(linked.length, `it links system libraries at all (found: ${linked.join(", ") || "none"})`)
      .toBeGreaterThan(0);

    if (isWindows) {
      expect(foreignImports(linked, installedSystemDlls()), `found: ${linked.join(", ")}`).toEqual([]);
      return;
    }

    for (const library of linked) {
      expect(library, "only the C runtime may be linked").toMatch(/^(libc|libgcc_s|ld-linux).*\.so/);
    }
  });

  it("declares no dependencies at all", () => {
    // Read rather than inferred from a successful build. `cargo build` passing
    // proves nothing about this — it ran in `beforeAll` either way — and what is
    // being held is the *declaration*: a dependency added and not yet used still
    // builds, still passes everything above, and is one `cargo update` away from
    // mattering on somebody else's machine.
    const manifest = readFileSync(join(ASK_DIR, "Cargo.toml"), "utf8");

    // Every dependency table in the file, with section headers stripped, so what
    // is left is only the dependencies themselves. `[dependencies]` and
    // `[target.'cfg(unix)'.dependencies]` both count.
    const declared = manifest
      .split(/\n\s*\[/)
      .filter((section) => /^(target\..*\.)?dependencies\s*$/.test(section.split("]")[0]!.trim()))
      .flatMap((section) => section.slice(section.indexOf("]") + 1).split("\n"))
      .map((line) => line.replace(/^\s*#.*$/, "").trim())
      .filter(Boolean);

    // Empty on Unix, where `libc` is compiled in, and `libc` alone on every
    // platform that declares one. The relay's manifest argues this at length;
    // this is the assertion rather than the prose.
    const allowed = process.platform === "win32" ? [] : ["libc = \"0.2\""];
    expect(declared).toEqual(allowed);
  });
});

describe("the built file is named the way this platform spells it", () => {
  it("appends .exe on Windows and nothing elsewhere", () => {
    // The rule rather than this machine's answer, because the mistake this
    // prevents — a hook pointing at a file that does not exist, reported as a
    // success — could only ever be caught by running on the platform it affects.
    expect(binaryName("spark-ask", "win32")).toBe("spark-ask.exe");
    expect(binaryName("spark-ask", "linux")).toBe("spark-ask");
    expect(binaryName("spark-ask", "darwin")).toBe("spark-ask");
  });

  it("resolves the binary under the crate that builds it", () => {
    expect(askCommand("linux")).toContain(join("ask", "target", "release"));
    expect(askCommand("win32")).toContain(join("ask", "target", "release"));
    expect(askCommand("win32").endsWith("spark-ask.exe")).toBe(true);
  });
});