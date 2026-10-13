import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The scripts must not work out where the relay is for themselves.
 *
 * Three callers need that path — the installer, the integration check, and the
 * relay tests — and all three carried their own hardcoded copy. Two were wrong in
 * the same way: `target/release/spark-relay` with no extension, which resolves on
 * Linux and does not exist on Windows, where cargo appends `.exe`. So
 * `relay:install` would have written hooks pointing at a file that is not there,
 * and reported success while doing it.
 *
 * A behavioural test cannot catch a duplicated constant, because each copy
 * behaves correctly for the machine that wrote it. What makes this visible is
 * that all the copies can be *read*, and the property being protected is that
 * there is only one of them.
 *
 * This is the approach `relay-shape.test.ts` and `selection-source.test.ts`
 * already take, and for the same reason: some properties are about the shape of
 * the code rather than what it does when run, and only reading it can see them.
 */

/** The scripts that invoke the relay, and the tests that inspect its build. */
const CALLERS = [
  "scripts/relay-install.ts",
  "scripts/relay-integration.ts",
  "test/relay.test.ts",
];

/** The one place allowed to name the built binary's location. */
const OWNER = "src/relay/binary.ts";

/**
 * Files allowed to name a build path without being callers of the owner.
 *
 * The owner's own test, and the decision check — which has to say which binary it
 * is running in order to run it at all, and gets its *name* from the owner's rule
 * rather than by spelling one out.
 *
 * Listed rather than exempted by pattern, so a third script that grew its own
 * path would have to be added here deliberately, by somebody reading why.
 */
const ALLOWED = ["test/relay-binary.test.ts", "scripts/decision-integration.ts"];

const sourceOf = (relative: string): string =>
  readFileSync(join(import.meta.dirname, "..", relative), "utf8");

/** Source with comments removed, so prose about a path is not read as a path. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

describe("only one place knows where the relay is built", () => {
  it("lists every file that resolves the relay's path", () => {
    // The guard is only as good as its coverage: a caller this list has not heard
    // of would carry its own path and be checked by nothing. So the list is
    // checked against the tree, and a file that resolves the path without being
    // named here fails here rather than going unnoticed.
    const inTree = [
      ...readdirSync(join(import.meta.dirname, "../scripts"))
        .filter((name) => name.endsWith(".ts"))
        .map((name) => `scripts/${name}`),
      ...readdirSync(join(import.meta.dirname))
        .filter((name) => name.startsWith("relay") && name.endsWith(".test.ts"))
        .map((name) => `test/${name}`),
      "src/relay/install.ts",
    ];

    for (const file of inTree) {
      // This file names every one of these terms by necessity — it is the thing
      // looking for them. Including it would make the guard fail on itself.
      if (file === "test/relay-binary-wiring.test.ts") continue;

      const body = code(sourceOf(file));
      // Named by whoever needs the path, which is a narrower signal than "mentions
      // the relay" — a comment or a log line is not a second copy of the answer.
      //
      // `target/release` catches a build path spelled out anywhere, whichever
      // crate it belongs to. That is broader than this file was written to be and
      // it is the right breadth: the rule being protected is that the extension
      // cargo appends is asked in one place, and a second `target/release` in a
      // third file is how a script comes to disagree with the installer about
      // what a binary is called on Windows.
      //
      // `relay-binary.test.ts` and `decision-integration.ts` are allowed to name
      // it: the first is the owner's own test, the second is a check that has to
      // say which binary it is running.
      const resolvesIt =
        body.includes("target/release") || body.includes("relayCommand(");
      if (!resolvesIt) continue;

      expect(
        [...CALLERS, OWNER, ...ALLOWED].includes(file),
        `${file} resolves a built binary's path but is not listed`
      ).toBe(true);
    }
  });

  it("keeps the path out of every caller", () => {
    for (const file of CALLERS) {
      const body = code(sourceOf(file));
      // The build directory is the half of the answer nobody needs to write down,
      // and `target/release` appearing anywhere else is a copy of the path.
      //
      // The binary's bare name is *not* forbidden: `relay-install.ts` prints
      // `spark-relay` as its own command name in usage text, which is what the
      // user types and has nothing to do with the file's location. Forbidding it
      // would make the guard fail on correct code, and a guard that fails on
      // correct code gets deleted.
      expect(body, `${file} names the build directory`).not.toContain("target/release");
    }
  });

  it("has every caller take the path from the owner", () => {
    for (const file of CALLERS) {
      const body = code(sourceOf(file));
      expect(
        body.includes("relay/binary.ts"),
        `${file} does not get the relay's path from ${OWNER}`
      ).toBe(true);
    }
  });

  it("lets the owner keep both answers", () => {
    // The negative tests above are only meaningful if something is allowed to hold
    // the answer. Without this, the "fix" would be deleting the knowledge, which
    // fails in a more confusing way than it does now.
    const owner = code(sourceOf(OWNER));
    expect(owner).toContain("target/release");
    expect(owner).toContain("spark-relay");
  });
});

describe("no caller decides for itself what a binary is", () => {
  it("keeps the header check in the owner", () => {
    // `isNativeBinary` exists because one caller checked for `\x7fE` — an ELF —
    // and would have reported the Windows build as a script needing an
    // interpreter. The opposite of the truth, about the one file the check exists
    // to look at.
    for (const file of CALLERS) {
      const body = code(sourceOf(file));
      expect(body, `${file} checks a binary header itself`).not.toMatch(
        /x7fE|0x7f, ?0x45|\\x4d|"MZ"/
      );
    }
  });

  it("keeps the platform branch out of the hook path", () => {
    // `claude` is a `.cmd` on Windows and `spawn` without a shell cannot resolve
    // one, so the integration check needs a platform branch to reach the agent at
    // all. `install.ts` must not have one: the command written into the user's
    // settings is spawned by the host agent rather than by us, and a path needing
    // a shell would fail once per event in an environment this project cannot
    // predict. That is the whole reason the relay is a compiled binary.
    const installer = code(sourceOf("src/relay/install.ts"));
    expect(installer).not.toContain("process.platform");
    expect(installer).not.toContain(".cmd");
  });

  it("writes the relay's own path into the hook, not a wrapped one", () => {
    // The consequence of the branch above: whatever the platform, the command is
    // the relay. If a wrapper ever appears here it is a runtime dependency in the
    // hook path, which is the failure the Rust binary exists to avoid.
    const installer = code(sourceOf("src/relay/install.ts"));
    expect(installer).toMatch(/relayCommand/);
  });
});
