/**
 * Where the relay's built binary is, and whether it is one.
 *
 * ## Why this is its own module
 *
 * Three callers need the same two answers, and they are the scripts that install
 * the hooks, the check that runs the real agent, and the tests that read the
 * file's bytes. When each of them worked it out separately they disagreed, and
 * the disagreement was invisible on the machine that wrote them: a path spelled
 * `spark-relay` resolves on Linux and does not exist on Windows, where cargo
 * appends `.exe`, so the installer would have written hooks pointing at a file
 * that is not there and reported success.
 *
 * That failure mode is worth designing against rather than against the symptom.
 * An installer that reports success while writing a broken path is worse than one
 * that refuses, because the user finds out when their agent quietly stops
 * reporting — so the answer lives in one place and the callers are thin.
 *
 * ## The two questions
 *
 * *Which file* is a build-layout fact that differs by platform. *Whether it is a
 * binary* is what makes it safe to put in a hook at all: the host agent spawns it
 * directly, so anything carrying a `#!` line depends on an interpreter being
 * found from whatever environment the agent happens to spawn hooks in, which is
 * not the developer's shell and is not guaranteed to be anything.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The relay's name on this platform.
 *
 * Cargo appends `.exe` on Windows and nothing anywhere else. This is the rule
 * rather than the answer: a caller passes the base name and gets the spelling
 * this machine actually uses, so there is no hardcoded path anywhere to be right
 * about on one platform and wrong on another.
 *
 * The platform is a parameter so this can be checked for a platform it is not
 * running on. That is the whole reason it is not `process.platform` read inline:
 * the bug this rule prevents could only ever have been found by running on the
 * platform it affects, which is the one platform this project cannot run on.
 */
export function relayBinaryName(base: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${base}.exe` : base;
}

/**
 * The relay, as the host agent will invoke it.
 *
 * Absolute, because a hook runs in whatever directory the session started from.
 * A relative path would resolve against that rather than against anything it
 * means, and a hook that cannot find its own binary is a hook that fails once
 * per event for the rest of the user's time with the agent.
 *
 * This is the only place in the companion that knows where the built binary is.
 *
 * A function rather than a constant so that a test can ask what it answers on a
 * platform other than this one. The naming rule is the thing that was got wrong
 * twice, and a value computed at import time could only ever be checked against
 * the machine running the test — which is exactly how both mistakes survived
 * being written on Linux.
 */
export function relayCommand(platform: NodeJS.Platform = process.platform): string {
  // Up out of `src/relay` to the repository root, then into the Rust crate.
  // Written relative to this module so moving it does not silently repoint every
  // installed hook at a different file.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

  return resolve(repoRoot, "relay/target/release", relayBinaryName("spark-relay", platform));
}

/**
 * Whether these bytes are a native executable rather than a script.
 *
 * An ELF (`\x7fELF`) or a PE (`MZ`), and specifically not a shebang. The test is
 * written as "one of the two known headers" rather than "not a shebang" on
 * purpose: the failure we care about is a relay that cannot start, and an
 * unrecognised format is at least as likely to be that as a script is. A test
 * that accepted anything-not-`#!` would pass on a truncated or corrupt build.
 */
export function isNativeBinary(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;

  const elf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
  const pe = bytes[0] === 0x4d && bytes[1] === 0x5a; // "MZ"

  return elf || pe;
}
