/**
 * `npm run build` — the relay, then the waiting program, then the companion, in
 * that order, and a failure that says which one.
 *
 * ```
 *   relay ──┐
 *           ├──> shell (the installer has to name the other two)
 *   ask ────┘
 * ```
 *
 * ## The order is a dependency, and the build checks it
 *
 * `packaging` exists because the product worked and could not be started. Three
 * Rust programs, a bundler, and hooks pointing at absolute paths into one
 * machine's checkout; there was no way for a person to install this and have it
 * run.
 *
 * The order above is not a convention anybody has to remember. Each step declares
 * what has to exist before it may start, and the paths it declares are resolved
 * through `src/relay/binary.ts` — the one place allowed to name where a built
 * binary is, and the place that owns cargo's `.exe` rule. So the bundler step
 * refuses to run with a missing program beside the companion rather than
 * producing an artefact whose installer points at nothing, and that refusal is
 * what `test/build.test.ts` drives.
 *
 * ## Why a failure names itself
 *
 * `cargo build` failing prints a wall of output and stops. That is not wrong; it
 * is just not an answer to "which thing do I fix", and it has to be scrolled to
 * find out. So each step's output goes to its own log under
 * `shell/src-tauri/target/build-logs/`, one progress line goes to the terminal,
 * and a failure prints the step's name, what that step was for, and where the
 * full output is. Everything after it does not run, because a later step's inputs
 * would be missing and its own failure would be a symptom.
 *
 * ## What this deliberately does not do
 *
 * No code signing, no notarisation, no auto-update. An unsigned macOS build will
 * not open without a right-click, which is honest and is one step for the user to
 * take; a self-signed certificate that expires is neither, and it expires on a
 * schedule nobody in this project controls.
 */

import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { askCommand, programsBeside, relayCommand, shellCommand } from "../src/relay/binary.ts";

/** The repository root, from this file rather than from the cwd. */
export const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Where each step's full output is kept. Under `target/`, so it is never committed. */
export const LOG_DIRECTORY = join(REPO, "shell/src-tauri/target/build-logs");

/** A command, as it is spawned: no shell, so no path is ever re-tokenised. */
export interface Command {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * One step of the build.
 *
 * `needs` is the dependency, stated rather than implied. A step whose inputs are
 * absent is refused before it starts, which is the difference between "the build
 * order is right" and "the build order is a convention": the second is a claim
 * about this file, and the first is a claim about what happens when it is wrong.
 */
export interface BuildStep {
  /** What this is called in the output, and what a failure is reported against. */
  readonly name: string;
  /** What it produces, in one line — for the reader who has just hit a failure. */
  readonly what: string;
  /** The commands, in order. The step fails if any one of them does. */
  readonly commands: readonly Command[];
  /** Files that must already exist before this step may run. */
  readonly needs: readonly string[];
  /**
   * What to tell the reader when one of `needs` is absent.
   *
   * A step whose inputs are missing because they were never built wants
   * "run the build"; a step whose inputs are missing because a committed file was
   * deleted wants "regenerate that file", and the wrong sentence sends the reader
   * to run a two-minute build that will fail the same way at the same line.
   */
  readonly missing?: string;
  /**
   * Copies to make once the commands are done.
   *
   * The programs step has them and nothing else does, because copying is the one
   * thing a build step does that is not running a command, and putting it in the
   * same shape as the others keeps "the build is a list of steps" true.
   */
  readonly copies?: readonly (readonly [string, string])[];
}

/** Where the shell's own configuration lives, and the icon list it declares. */
export const TAURI_CONFIG = join(REPO, "shell/src-tauri/tauri.conf.json");

/** The command that regenerates the committed icon set. */
export const MAKE_ICONS = "python3 shell/src-tauri/icons/make-icons.py";

/**
 * Every icon the bundle declares, resolved against the directory that declares it.
 *
 * **Read from the configuration rather than listed here**, and that is the whole
 * of the guarantee: an icon the bundle asks for and this build has never heard of
 * is an icon a build failure nobody can act on. The formats differ per platform
 * and a wrong one does not produce an ugly icon — it produces a build failure, on
 * the machine nobody is watching. So the check is derived from the same
 * declaration the bundler reads, and a missing file is named.
 */
export function declaredBundleIcons(): string[] {
  const config = JSON.parse(readFileSync(TAURI_CONFIG, "utf8")) as {
    readonly bundle?: { readonly icon?: readonly string[] };
  };
  const icons = config.bundle?.icon ?? [];

  return icons.map((icon) => join(REPO, "shell/src-tauri", icon));
}

/**
 * The build, as a list.
 *
 * A function of the platform so the list can be checked for a platform this
 * machine is not — the same reason `relayCommand` takes one. What does *not*
 * depend on the platform is the order, and that is asserted against the list
 * rather than read off the source.
 */
export function buildSteps(platform: NodeJS.Platform = process.platform): BuildStep[] {
  const relay = relayCommand(platform);
  const ask = askCommand(platform);
  const shell = shellCommand(platform);

  // Where the build puts the programs. Resolved once, through the owner, and
  // reused by the step's copy list and its `needs`, so the destination and the
  // thing checked for are the same string by construction.
  const beside = programsBeside(shell, platform);

  return [
    {
      name: "icons",
      what: "the icon set the bundle is built from",
      // First, and it costs nothing: every icon is committed, so a missing one is
      // a deleted file rather than something this build has to go and make, and
      // finding that out before two minutes of cargo beats finding it out after.
      commands: [],
      needs: declaredBundleIcons(),
      missing: `is missing from the committed icon set. Regenerate it with: ${MAKE_ICONS}`,
    },
    {
      name: "relay",
      what: "the program the host agent's hooks invoke",
      commands: [
        { command: "cargo", args: ["build", "--release", "--manifest-path", "relay/Cargo.toml"] },
      ],
      needs: [],
    },
    {
      name: "ask",
      what: "the program that waits for your answer",
      commands: [
        { command: "cargo", args: ["build", "--release", "--manifest-path", "ask/Cargo.toml"] },
      ],
      needs: [],
    },
    {
      name: "shell",
      what: "the window, and the page it loads",
      // The frontend first: `tauri.conf.json` embeds `shell/dist`, so a build
      // with an empty or stale directory produces a window showing the wrong
      // page, or nothing, and the error for that is a blank window rather than a
      // message. Two commands in one step because they are one artefact.
      commands: [
        { command: "npx", args: ["vite", "build", "--config", "shell/vite.config.ts"] },
        {
          command: "cargo",
          args: ["build", "--release", "--manifest-path", "shell/src-tauri/Cargo.toml"],
        },
      ],
      needs: [],
    },
    {
      name: "programs",
      what: "the two programs, beside the window's own executable",
      // The heart of it. A hook is an absolute path to a file, and an absolute
      // path into a checkout is an answer that expires the first time the user
      // moves or deletes that checkout — so the programs go where the installed
      // executable is, and the installer resolves them against it.
      commands: [],
      needs: [relay, ask, shell],
      copies: [
        [relay, beside.relay],
        [ask, beside.ask],
      ],
    },
    {
      name: "bundle",
      what: "the platform artefact you install",
      commands: [{ command: "npx", args: ["tauri", "build"] }],
      // Last, and refused without them: the artefact carries an installer, and
      // the hooks that installer sets up have to name files that are there.
      needs: [beside.relay, beside.ask],
    },
  ];
}

/** What running one command produced. */
export interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Runs one command. Injected so the order can be checked without a Rust toolchain. */
export type Run = (command: Command, log: string) => Promise<CommandResult>;

/** What a whole build did. */
export interface BuildOutcome {
  /** Steps that finished, in order. */
  readonly completed: readonly string[];
  /** The step that stopped it, or `null` when everything was built. */
  readonly failed: string | null;
  /** Why, when it failed: the step's name and one line saying why. */
  readonly failure: string | null;
  /** Everything the build said, in the order it said it. */
  readonly lines: readonly string[];
}

export interface BuildOptions {
  readonly run: Run;
  /** Whether a file is there. Injected, so a missing input is a scenario not a state. */
  readonly exists?: (path: string) => boolean;
  readonly copy?: (from: string, to: string) => Promise<void>;
  readonly say?: (line: string) => void;
  readonly platform?: NodeJS.Platform;
}

/**
 * Run the build, stopping at the first step that cannot start or does not finish.
 *
 * Every side effect is injected. That is not for testing's convenience alone — it
 * is what lets `test/build.test.ts` drive a build whose steps fail, whose inputs
 * are missing, and whose filesystem is a set of strings, and assert on what the
 * build *said*, which is the thing this script is actually for.
 */
export async function runBuild({
  run,
  exists = (path: string): boolean => true,
  copy = async (from, to): Promise<void> => {
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  },
  say = (): void => {},
  platform = process.platform,
}: BuildOptions): Promise<BuildOutcome> {
  const lines: string[] = [];
  const completed: string[] = [];
  const record = (line: string): void => {
    lines.push(line);
    say(line);
  };

  for (const step of buildSteps(platform)) {
    const missing = step.needs.filter((path) => !exists(path));

    // Named by what it is and by what is absent. "build failed" with a cargo
    // wall above it is the failure mode this line exists to replace.
    if (missing.length > 0) {
      const list = missing.join(", ");
      const because = step.missing ?? "not built. Run `npm run build` from the top.";
      const failure = `build: ${step.name} cannot start — ${list} ${because}`;
      record(failure);
      return { completed, failed: step.name, failure, lines };
    }

    record(`build: ${step.name} — ${step.what}`);

    for (const command of step.commands) {
      const log = join(LOG_DIRECTORY, `${step.name}.log`);
      const spelled = [command.command, ...command.args].join(" ");

      let result: CommandResult;
      try {
        result = await run(command, log);
      } catch (error) {
        const failure = `build: ${step.name} failed — could not run \`${spelled}\` (${(error as Error).message})`;
        record(failure);
        return { completed, failed: step.name, failure, lines };
      }

      if (result.code !== 0) {
        const how =
          result.signal !== null
            ? `was killed by ${result.signal}`
            : `exited ${result.code ?? "with no status"}`;
        const failure = `build: ${step.name} failed — ${step.what} did not build. \`${spelled}\` ${how}. Full output: ${log}`;
        record(failure);
        return { completed, failed: step.name, failure, lines };
      }
    }

    for (const [from, to] of step.copies ?? []) {
      try {
        await copy(from, to);
      } catch (error) {
        const failure = `build: ${step.name} failed — could not copy ${from} to ${to} (${(error as Error).message})`;
        record(failure);
        return { completed, failed: step.name, failure, lines };
      }
      record(`build: ${step.name} — copied ${to}`);
    }

    completed.push(step.name);
  }

  record("build: done. The directory beside spark-shell is the installation.");
  return { completed, failed: null, failure: null, lines };
}

/* ------------------------------------------------------------- the real thing */

/**
 * Run a command, keeping everything it printed.
 *
 * Nothing is echoed to the terminal. That is the decision the whole failure shape
 * rests on: the log is complete, so the terminal can say one line and still have
 * something to point at, and a reader who needs the wall can open the file.
 */
const runForReal: Run = (command, log) =>
  new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: REPO,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    mkdir(LOG_DIRECTORY, { recursive: true })
      .then(() => createWriteStream(log, { flags: "w" }))
      .then((sink) => {
        child.stdout.pipe(sink);
        child.stderr.pipe(sink);
      })
      .catch(reject);

    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

/**
 * Build it, when this file was asked to rather than imported.
 *
 * The guard is what lets `test/build.test.ts` import the step list and drive a
 * build that fails, without a Rust toolchain, without cargo, and without producing
 * a real binary on the machine running the suite. A script that ran on import
 * could only be tested by running it.
 */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outcome = await runBuild({
    run: runForReal,
    exists: existsSync,
    say: (line) => process.stdout.write(`${line}\n`),
  });

  // A non-zero exit, not a thrown error: npm already prints our one line either
  // way, and an exception here would also print a stack — which is the wall of
  // output this script exists not to produce.
  if (outcome.failed !== null) process.exitCode = 1;
}