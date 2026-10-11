import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  companionAddress,
  currentCompanionAddress,
  currentIdentity,
} from "../src/relay/address";

/**
 * The address contract, and the duplication that makes it a contract at all.
 *
 * The companion derives the address in TypeScript and the relay derives it in
 * Rust. Two implementations of one rule is the thing this project has spent its
 * adapter boundary avoiding, and it is here anyway for a stated reason: the
 * relay has to run with no language runtime and no installed package, and there
 * is no way to satisfy that and share code with a TypeScript companion.
 *
 * So the duplication is made checkable instead of trusted. The companion half is
 * tested here; the two halves are compared against each other in
 * `test/relay.test.ts`, which builds the binary and delivers a payload to the
 * address this module derives. If the two ever disagree the companion goes
 * silent, and nothing else would report it.
 *
 * Nothing in this file opens the real channel. Tests that do share one address,
 * and vitest runs files in parallel.
 */

const RELAY_SRC = join(import.meta.dirname, "../relay/src");

const relaySource = (file: string): string => readFileSync(join(RELAY_SRC, file), "utf8");

describe("the address is derived from the owning user", () => {
  it("namespaces Unix addresses by uid, so two users cannot collide", () => {
    const alice = companionAddress({ kind: "uid", uid: 1001 });
    const bob = companionAddress({ kind: "uid", uid: 1002 });

    expect(alice).not.toBe(bob);
    expect(alice).toBe("/tmp/spark-1001/companion.sock");
    expect(bob).toBe("/tmp/spark-1002/companion.sock");
  });

  it("namespaces Windows pipes by account name, by the same rule", () => {
    // The same derivation — the owning user's identity — in the form each
    // platform can carry. Windows has no uid, so the account name carries it.
    const alice = companionAddress({ kind: "name", name: "alice" });
    const bob = companionAddress({ kind: "name", name: "bob" });

    expect(alice).not.toBe(bob);
    expect(alice).toBe("\\\\.\\pipe\\spark-alice-companion");
    expect(bob).toBe("\\\\.\\pipe\\spark-bob-companion");
  });

  it("keeps a uid and an account name from being confused for each other", () => {
    // `1001` is a valid Windows account name and a valid uid. Formatted by one
    // rule rather than two, a user could land at the other platform's address
    // and the companion would simply never be reached.
    expect(companionAddress({ kind: "uid", uid: 1001 })).not.toBe(
      companionAddress({ kind: "name", name: "1001" })
    );
  });

  it("reports this machine's own identity and address", () => {
    const identity = currentIdentity();
    expect(identity).not.toBeNull();

    // The same value derived both ways, which is what the relay relies on when
    // it derives the address on its own.
    expect(currentCompanionAddress()).toBe(companionAddress(identity!));

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
    const first = currentCompanionAddress();
    expect(currentCompanionAddress()).toBe(first);
    expect(currentCompanionAddress()).toBe(first);
  });
});

describe("the address does not come from the environment", () => {
  it("is not read from a variable that the spawning environment could differ in", () => {
    const address = relaySource("address.rs");

    // The relay is spawned by the host agent, in an environment it does not
    // control. A runtime-directory variable is set by a session manager and
    // inherited by whatever the agent happens to start; it is absent under some
    // launchers. Reading it would make the two halves able to disagree, and the
    // disagreement is silent.
    expect(address).not.toMatch(/XDG_RUNTIME_DIR|TMPDIR|\/run\/user/);

    // `USERNAME` is the one environment read, and it is an identity rather than
    // a location — the account a Windows pipe is named for.
    const envReads = [...address.matchAll(/env::var\("([A-Z_]+)"\)/g)].map((m) => m[1]);
    expect(envReads.filter((name) => name !== "USERNAME")).toEqual([]);
  });

  it("is not supplied by the caller on either side", () => {
    // The relay takes no argument naming an address, and the companion's own
    // caller does not pass one: `openChannel` is called with a handler and
    // nothing else, so the address it binds is the derived one.
    expect(relaySource("main.rs")).not.toMatch(/std::env::args/);
    expect(relaySource("main.rs")).not.toMatch(/(^|[^A-Za-z])--address/i);
    expect(relaySource("main.rs")).not.toMatch(/\b(COMPANION_ADDRESS|SPARK_ADDRESS)\b/);

    const channel = readFileSync(
      join(import.meta.dirname, "../src/relay/channel.ts"),
      "utf8"
    );
    expect(channel).toMatch(/options\.address \?\? currentCompanionAddress\(\)/);
  });
});