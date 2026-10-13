/**
 * Where a built binary is, and whether it is one.
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
 * It grew a second program when `ask/` arrived, and the reason it did not grow a
 * second module is the reason the first module exists: the extension rule is the
 * one fact that was got wrong twice, and a second copy of the fact is how it
 * gets got wrong a third time, on a machine that has not happened yet.
 *
 * ## Where an *installed* copy looks, which is a second answer rather than a second rule
 *
 * `relayCommand` answers for a checkout, and a checkout is a developer's working
 * directory: a user who cloned it and deleted it should get a clear error, not a
 * hook that silently fails per event. So an installed companion resolves the same
 * two programs against its own executable, and this module owns that answer too —
 * `programsBeside`, `installedPrograms`, `findInstalledPrograms`. The naming rule
 * is shared between the two answers, so an installation cannot come to disagree
 * with a build about what cargo calls a Windows binary.
 *
 * ## The two questions
 *
 * *Which file* is a build-layout fact that differs by platform. *Whether it is a
 * binary* is what makes it safe to put in a hook at all: the host agent spawns it
 * directly, so anything carrying a `#!` line depends on an interpreter being
 * found from whatever environment the agent happens to spawn hooks in, which is
 * not the developer's shell and is not guaranteed to be anything.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A binary's name on this platform.
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
export function binaryName(base: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? `${base}.exe` : base;
}

/**
 * The name `relayBinaryName` is documented as answering.
 *
 * A re-export rather than a second function, so the callers that already knew
 * this name keep working and the rule still has exactly one implementation.
 */
export const relayBinaryName = binaryName;

/** The one place allowed to name a built binary's location. */
const CRATE = (crate: string, binary: string): string =>
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../..",
    crate,
    "target/release",
    binary
  );

/**
 * The bare names cargo is asked to produce, before this platform's spelling.
 *
 * Carried as data rather than written into each call site because the build has
 * to say what it is about to copy, and a caller that spelled one out would be
 * spelling out the same fact a third time — which is the whole reason this module
 * exists.
 */
const RELAY_BASE = "spark-relay";
const ASK_BASE = "spark-ask";
const SHELL_BASE = "spark-shell";

/**
 * The relay, as the host agent will invoke it.
 *
 * Absolute, because a hook runs in whatever directory the session started from.
 * A relative path would resolve against that rather than against anything it
 * means, and a hook that cannot find its own binary is a hook that fails once
 * per event for the rest of the user's time with the agent.
 *
 * This is the only place in the companion that knows where the built binaries
 * are.
 *
 * A function rather than a constant so that a test can ask what it answers on a
 * platform other than this one. The naming rule is the thing that was got wrong
 * twice, and a value computed at import time could only ever be checked against
 * the machine running the test — which is exactly how both mistakes survived
 * being written on Linux.
 */
export function relayCommand(platform: NodeJS.Platform = process.platform): string {
  return CRATE("relay", binaryName(RELAY_BASE, platform));
}

/**
 * The waiting program, as the host agent will invoke it.
 *
 * The same reasoning, for a program that matters more: this one runs on the
 * critical path of a tool call, so a hook pointing at a file that is not there
 * is a stall on every tool call rather than a report that stops arriving. It
 * takes a platform parameter for the same reason `relayCommand` does.
 */
export function askCommand(platform: NodeJS.Platform = process.platform): string {
  return CRATE("ask", binaryName(ASK_BASE, platform));
}

/**
 * The companion's own executable, as the build leaves it.
 *
 * A third program in the same place because the build and the doctor both have to
 * name it: the build copies the other two next to it, and the doctor's question
 * "are the hooks pointing at *this* install?" is answered by resolving them
 * against it. Not a hook command, so it has no place in `PlanOptions` — nothing
 * spawns it — but it is a built binary at a build location, which is what this
 * module owns.
 */
export function shellCommand(platform: NodeJS.Platform = process.platform): string {
  return CRATE("shell/src-tauri", binaryName(SHELL_BASE, platform));
}

/* ------------------------------------------------------ installed, not built */

/**
 * The two programs as an installed companion spells them.
 *
 * A pair rather than one string because they are always both needed and always
 * installed together, and a caller that wanted only one would otherwise write the
 * directory rule again in order to get it.
 */
export interface InstalledPrograms {
  /** The relay, absolute, as the host agent will invoke it. */
  readonly relay: string;
  /** The waiting program, absolute, as the host agent will invoke it. */
  readonly ask: string;
}

/**
 * The directory a platform bundle installs a resource into, beside the executable.
 *
 * Named here rather than in the caller because it is Tauri answering, not this
 * project: a packaged build keeps its extra files in `resources/`, while a
 * directory somebody copied keeps them beside the program. Written down once, so
 * "where does an installed copy look" has one answer rather than one per caller
 * that had to guess.
 */
const RESOURCES_DIRECTORY = "resources";

/**
 * The programs as they sit in a given directory.
 *
 * A directory rather than an executable, because "beside the window" is derived
 * from one (`programsBeside`) and "inside the bundle's resources" is not — and
 * making the primitive the directory is what stops the second being computed by
 * passing `.../resources` where an executable belongs, which silently resolves to
 * the parent and looks for the files in the wrong place.
 *
 * **Resolved relative to the installation rather than to a checkout**, and that
 * is the whole of the claim. A path into a source tree stops being true the day
 * somebody deletes the clone, and a hook pointing at it then fails once per event
 * for the rest of their time with the agent — silently, because a hook that
 * fails looks exactly like an agent with nothing to report. Resolving against the
 * installation means the answer travels with the files, so moving the
 * installation moves the answer with it.
 *
 * A function of a path rather than a constant, for the reason `relayCommand` is:
 * the platform is a parameter so both platforms' answers are assertable from a
 * machine that is only ever one of them.
 */
export function programsIn(
  directory: string,
  platform: NodeJS.Platform = process.platform
): InstalledPrograms {
  return {
    relay: join(directory, binaryName(RELAY_BASE, platform)),
    ask: join(directory, binaryName(ASK_BASE, platform)),
  };
}

/** The programs as they sit beside a given executable. */
export function programsBeside(
  executable: string,
  platform: NodeJS.Platform = process.platform
): InstalledPrograms {
  return programsIn(dirname(executable), platform);
}

/**
 * Every place an installed copy looks for its programs, in the order it looks.
 *
 * First beside the executable, which is where `npm run build` puts them and where
 * they are on a machine that was handed a directory. Then the `resources`
 * directory a packaged install keeps them in, because that is a different layout
 * from a directory somebody copied — and a resolver that knew only the first
 * would report a working installation as a broken one, which is the one failure
 * mode a diagnostic must not have.
 *
 * Both are returned rather than the first that happens to exist, because a caller
 * has to be able to say *where it looked*, and that is most of what a report is.
 */
export function installedPrograms(
  executable: string,
  platform: NodeJS.Platform = process.platform
): InstalledPrograms[] {
  return [
    programsBeside(executable, platform),
    programsIn(join(dirname(executable), RESOURCES_DIRECTORY), platform),
  ];
}

/** What looking for an installed companion's programs found, and where it looked. */
export interface InstalledSearch {
  /** The programs, once found. `null` when no candidate directory had both. */
  readonly found: InstalledPrograms | null;
  /** Every directory searched, in order, whether or not anything was in it. */
  readonly searched: readonly string[];
}

/** Whether this machine has a file at a path. Injected so a lookup is testable. */
const existsOnDisk = (path: string): boolean => existsSync(path);

/**
 * Which answer a script should use, and where it came from.
 *
 * `source` is not decoration. A hook written against one answer and checked
 * against the other is the exact disagreement `test/relay-binary-wiring.test.ts`
 * exists to prevent, and a caller that cannot say which answer it used cannot
 * notice that it changed.
 */
export interface ResolvedPrograms {
  /** The two programs, absolute, as the host agent should be told to invoke them. */
  readonly programs: InstalledPrograms;
  /** Whether these are the installed ones or the ones a build just produced. */
  readonly source: "installed" | "build";
  /** Every directory looked in, in order. Empty when the build answered directly. */
  readonly searched: readonly string[];
}

/**
 * The programs a hook should name.
 *
 * **An installation wins over a build**, and the reason is what a hook carries:
 * an absolute path. A path into a source checkout keeps working only while the
 * user leaves that checkout exactly where it is, and it fails silently when they
 * do not — once per event, with nothing in the agent's output to say why. A path
 * beside an installed executable travels with the files it names.
 *
 * The fallback is not a second policy, it is the only thing a developer needs:
 * someone who has run `cargo build` but not `npm run build` still has a working
 * pair of programs, and refusing to install hooks for them would make the one
 * command that works before a full build be the one that says no. The report says
 * which answer was used, so "it installed the wrong one" is answerable without
 * reading this.
 */
export function resolvePrograms(
  shell: string = shellCommand(),
  exists: (path: string) => boolean = existsOnDisk,
  platform: NodeJS.Platform = process.platform
): ResolvedPrograms {
  const search = findInstalledPrograms(shell, exists, platform);

  if (search.found) {
    return { programs: search.found, source: "installed", searched: search.searched };
  }

  return {
    programs: { relay: relayCommand(platform), ask: askCommand(platform) },
    source: "build",
    searched: search.searched,
  };
}

/**
 * Look for an installed companion's programs, and report where it looked.
 *
 * Pure over an injected `exists`, so it can be asked about a directory that does
 * not exist on this machine — which is the only way to check the half of this
 * that is about a layout nobody has here.
 */
export function findInstalledPrograms(
  executable: string,
  exists: (path: string) => boolean = existsOnDisk,
  platform: NodeJS.Platform = process.platform
): InstalledSearch {
  const searched: string[] = [];

  for (const candidate of installedPrograms(executable, platform)) {
    searched.push(dirname(candidate.relay));
    if (exists(candidate.relay) && exists(candidate.ask)) {
      return { found: candidate, searched };
    }
  }

  return { found: null, searched };
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
