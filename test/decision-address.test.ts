import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  companionAddress,
  currentCompanionAddress,
  currentDecisionAddress,
  currentIdentity,
  decisionAddress,
} from "../src/relay/address";

/**
 * The decision address, and the third implementation of the rule.
 *
 * There are now three files that answer "where is the companion": this one,
 * `relay/src/address.rs`, and `ask/src/address.rs`. That is duplication, and it
 * is duplication for a stated reason — every program on the host agent's
 * critical path has to start with no language runtime and no installed package,
 * and there is no way to have that and share code with a TypeScript companion.
 *
 * Two implementations can be compared by running both. Three cannot: the two
 * Rust programs run at the *same* address derivation machinery with different
 * socket names, and a test that binds one of them cannot bind the other while
 * `test/ask.test.ts` and `test/relay.test.ts` are also binding them — vitest
 * runs files in parallel, and two listeners on one path take the socket from
 * each other rather than sharing it.
 *
 * So the comparison is split by who owns what:
 *
 * - **The behaviour** — that the built binary reaches the address this module
 *   derives — is asserted in `test/ask.test.ts`, which owns the decision address
 *   because it spawns the program that uses it. If the two halves ever
 *   disagreed, nothing would arrive and every round-trip test in that file
 *   would fail; this file names the contract they are testing.
 * - **The rule** is asserted here, on both halves and against each other, with
 *   no socket involved. That is where a drift shows up first, and it shows up as
 *   a failing test rather than as a companion that has quietly gone silent.
 */

const ASK_SRC = join(import.meta.dirname, "../ask/src");
const RELAY_SRC = join(import.meta.dirname, "../relay/src");

const askSource = (file: string): string => readFileSync(join(ASK_SRC, file), "utf8");
const relaySource = (file: string): string => readFileSync(join(RELAY_SRC, file), "utf8");

describe("the decision address is derived from the owning user", () => {
  it("namespaces Unix addresses by uid, so two users cannot collide", () => {
    const alice = decisionAddress({ kind: "uid", uid: 1001 });
    const bob = decisionAddress({ kind: "uid", uid: 1002 });

    expect(alice).not.toBe(bob);
    expect(alice).toBe("/tmp/spark-1001/decisions.sock");
    expect(bob).toBe("/tmp/spark-1002/decisions.sock");
  });

  it("namespaces Windows pipes by account name, by the same rule", () => {
    // The same derivation — the owning user's identity — in the form each
    // platform can carry. Windows has no uid, so the account name carries it.
    expect(decisionAddress({ kind: "name", name: "alice" })).toBe(
      "\\\\.\\pipe\\spark-alice-decisions"
    );
    expect(decisionAddress({ kind: "name", name: "bob" })).not.toBe(
      decisionAddress({ kind: "name", name: "alice" })
    );
  });

  it("keeps a uid and an account name from being confused for each other", () => {
    // `1001` is a valid Windows account name and a valid uid. Formatted by one
    // rule rather than two, a user could land at the other platform's address
    // and the waiting program would simply never be reached.
    expect(decisionAddress({ kind: "uid", uid: 1001 })).not.toBe(
      decisionAddress({ kind: "name", name: "1001" })
    );
  });

  it("is the relay's address by the same rule, differing only in the file", () => {
    // One derivation, two sockets — and the reason is in `ask/src/address.rs`:
    // a listener that served both would have to guess which protocol it was
    // speaking by looking at the bytes. This is the assertion that keeps "the
    // same rule" from quietly becoming "the same socket".
    expect(decisionAddress({ kind: "uid", uid: 1001 }).replace("decisions", "companion")).toBe(
      companionAddress({ kind: "uid", uid: 1001 })
    );
    expect(decisionAddress({ kind: "name", name: "alice" }).replace("decisions", "companion")).toBe(
      companionAddress({ kind: "name", name: "alice" })
    );
    expect(decisionAddress({ kind: "uid", uid: 1001 })).not.toBe(
      companionAddress({ kind: "uid", uid: 1001 })
    );
  });

  it("reports this machine's own identity and address", () => {
    const identity = currentIdentity();
    expect(identity).not.toBeNull();

    expect(currentDecisionAddress()).toBe(decisionAddress(identity!));
    expect(currentDecisionAddress()).not.toBe(currentCompanionAddress());

    if (process.platform === "win32") {
      expect(identity?.kind).toBe("name");
    } else {
      expect(identity?.kind).toBe("uid");
      expect(identity?.kind === "uid" && identity.uid).toBe(process.getuid?.());
    }
  });

  it("derives the same address every time it is asked", () => {
    // Nothing is cached and nothing is read from the environment, so the answer
    // cannot depend on when it was asked or on who asked.
    const first = currentDecisionAddress();
    expect(currentDecisionAddress()).toBe(first);
    expect(currentDecisionAddress()).toBe(first);
  });
});

describe("both halves state the same rule, in two languages", () => {
  it("names the same two paths in Rust as this module derives", () => {
    // The exact strings on both sides, so a change to either is a failing test
    // here rather than a companion nothing can reach. This is the duplication
    // made checkable instead of trusted — the reason two files of it are worth
    // having, and the reason the cross-language behaviour is asserted by the
    // program actually delivering (see the file note).
    const ask = askSource("address.rs");
    const relay = relaySource("address.rs");

    expect(ask).toContain('"/tmp"');
    expect(ask).toContain("spark-{}/decisions.sock");
    // The Windows spelling, read as the source text rather than as a Rust string
    // literal: what has to match is the characters in the file, and the file
    // spells it inside a raw string.
    expect(ask).toMatch(/pipe\\spark-\{\}-decisions/);

    expect(relay).toContain('"/tmp"');
    expect(relay).toContain("spark-{}/companion.sock");
    expect(relay).toMatch(/pipe\\spark-\{\}-companion/);
  });

  it("takes the identity from the kernel on Unix, and from the account on Windows", () => {
    // The two derivations are the same derivation: which user is running.
    expect(askSource("address.rs")).toMatch(/geteuid/);
    expect(askSource("address.rs")).toMatch(/env::var\("USERNAME"\)/);
  });

  it("declares no dependencies in either crate, so both can be built and run", () => {
    // The whole reason there are three implementations of this rule rather than
    // one: both programs have to run on a machine with nothing installed. A
    // dependency would make the duplication accidental instead of principled,
    // because it could then have been avoided.
    for (const manifest of ["../ask/Cargo.toml", "../relay/Cargo.toml"]) {
      const text = readFileSync(join(import.meta.dirname, manifest), "utf8");
      const declared = text
        .split(/\n\s*\[/)
        .filter((section) => /^(target\..*\.)?dependencies\s*$/.test(section.split("]")[0]!.trim()))
        .flatMap((section) => section.slice(section.indexOf("]") + 1).split("\n"))
        .map((line) => line.replace(/^\s*#.*$/, "").trim())
        .filter(Boolean);

      // `libc` on Unix only, which is the C runtime's own header crate rather
      // than anything that has to be fetched and installed on the user's box.
      expect(declared, manifest).toEqual(process.platform === "win32" ? [] : ['libc = "0.2"']);
    }
  });
});

describe("the address does not come from the environment or a caller", () => {
  it("is not read from a variable that the spawning environment could differ in", () => {
    // The waiting program is spawned by the host agent, in an environment it
    // does not control. A runtime-directory variable is set by a session manager
    // and inherited by whatever the agent happens to start; it is absent under
    // some launchers. Reading it would let the two halves disagree, and the
    // disagreement is silent — the host simply stops waiting for an answer.
    const ask = askSource("address.rs");

    expect(ask).not.toMatch(/XDG_RUNTIME_DIR|TMPDIR|\/run\/user/);

    // `USERNAME` is the one environment read, and it is an identity rather than
    // a location — the account a Windows pipe is named for.
    const envReads = [...ask.matchAll(/env::var\("([A-Z_]+)"\)/g)].map((m) => m[1]);
    expect(envReads.filter((name) => name !== "USERNAME")).toEqual([]);
  });

  it("is not supplied by a caller on either side of the socket", () => {
    // The program takes no argument naming an address, and the companion's own
    // caller does not pass one: `openReplyChannel` falls back to the derived
    // address, which is the only value the program on the other end can reach.
    //
    // The option exists for tests, which is the same reason the one-way channel
    // has one: there is no path by which a production caller learns of it.
    expect(askSource("main.rs")).not.toMatch(/std::env::args/);
    expect(askSource("main.rs")).not.toMatch(/(^|[^A-Za-z])--address/i);
    expect(askSource("main.rs")).not.toMatch(/\b(COMPANION_ADDRESS|DECISION_ADDRESS|SPARK_ADDRESS)\b/);

    const channel = readFileSync(join(import.meta.dirname, "../src/relay/channel.ts"), "utf8");
    expect(channel).toMatch(/options\.address \?\? currentDecisionAddress\(\)/);
  });
});
