/**
 * `npm run doctor` — say what is installed, and change nothing.
 *
 * A person who has installed this and something is not working needs one command
 * that says what. It answers five questions and does it in the order that puts
 * the most likely cause first:
 *
 *   1. are the companion's hooks in the host agent's own configuration?
 *   2. do the programs those hooks name exist on this machine?
 *   3. are they *this* install's, or somebody else's paths left behind?
 *   4. is the companion listening where it says it would be?
 *   5. what does the platform report about a surface that can float?
 *
 * ## It changes nothing
 *
 * No file written, no hook installed, no setting altered. A diagnostic that
 * repairs things is a second thing with its own consent model, and the one thing
 * worse than a companion that will not start is a doctor that silently edits the
 * user's agent configuration while diagnosing it. `~/.claude/settings.json` is
 * user state the user did not ask us to write, and reading it is free.
 *
 * Held by `test/doctor.test.ts`, which runs this over a real settings file in a
 * scratch directory and reads the bytes, the timestamps and the directory
 * listing before and after, and by a guard that fails the build if this file ever
 * grows an import that can write.
 *
 * ## The floating answer is the surface's answer, not a second one
 *
 * The last item runs the same `canHoldPersistentSurface` the escalation surface
 * runs, so "the companion believes it cannot float" and "the platform says it
 * cannot float" are one answer reported twice rather than two answers that can
 * disagree. That matters because the two have already disagreed once, on
 * Windows 11, where the surface reported escalate-only and a persistent surface
 * works — see `docs/platform-findings.md`.
 *
 * Read from a plain `node` process there is no window behind this script, so the
 * answer it prints is `placement: "unknown"`, `held: false`, and that says the
 * *host* could not ask. It does not say the platform said no, and the report says
 * so in those words rather than leaving the distinction to the reader.
 */

import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { planHooks, USER_SETTINGS_PATH } from "../src/relay/install.ts";
import { binaryName, type ResolvedPrograms, resolvePrograms } from "../src/relay/binary.ts";
import { currentCompanionAddress } from "../src/relay/address.ts";
import {
  canHoldPersistentSurface,
  readHostWindow,
  type HostWindow,
} from "../src/escalation/capability.ts";

/* --------------------------------------------------------------- what to say */

/**
 * How bad a finding is.
 *
 * `absent` is separate from `bad` on purpose. A companion that is not running is
 * the normal state of a machine where nothing has blocked the agent, and a tool
 * that reported it as a failure would be reporting the user's afternoon as a
 * problem. The exit code turns on `bad` and nothing else.
 */
export type Severity = "ok" | "absent" | "bad";

export interface Finding {
  readonly severity: Severity;
  /** The question this answers, in the reader's words. */
  readonly subject: string;
  /** The answer, in one line. */
  readonly answer: string;
  /** What to do about it, when there is something to do. */
  readonly remedy?: string;
  /** Anything that has to be said to keep the answer honest. */
  readonly note?: string;
}

/** Everything the report is allowed to look at. Nothing here is written to. */
export interface DoctorInput {
  /** The host agent's settings, exactly. `""` when there is no file yet. */
  readonly settings: string;
  /** Why the settings could not be read, when they could not be. */
  readonly unreadable?: string;
  /** The programs this install would point hooks at. */
  readonly programs: ResolvedPrograms;
  /** Whether a file exists. Injected, so a missing program is a scenario. */
  readonly exists: (path: string) => boolean;
  /** Where the companion should be, and whether anything is there. */
  readonly companion: { readonly address: string | null; readonly reachable: boolean };
  /** What the platform reports about a persistent surface. */
  readonly capability: HostWindow | null;
  /** The path the report is about, for the reader to go and look at. */
  readonly settingsPath: string;
}

export interface DoctorReport {
  readonly findings: readonly Finding[];
  /** Whether anything is actually broken, as opposed to merely not there. */
  readonly broken: boolean;
}

/**
 * What a hook command is, whichever platform it was written on.
 *
 * Compared against `binaryName` rather than a literal, so this file cannot come
 * to disagree with the installer about what cargo calls a Windows binary — which
 * is the exact class of bug `test/relay-binary-wiring.test.ts` exists to prevent.
 */
function isCompanionCommand(command: string): boolean {
  const name = basename(command).toLowerCase();
  return (
    name === binaryName("spark-relay").toLowerCase() ||
    name === binaryName("spark-ask").toLowerCase()
  );
}

/**
 * Every program the settings file already names, deduplicated, in order.
 *
 * Read straight out of the file rather than through `planHooks`, because the
 * question is not "are they installed at *our* paths" but "what is written there
 * right now" — and those are different questions whenever a path has gone stale.
 */
function namedPrograms(settings: string): string[] {
  if (settings.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(settings);
  } catch {
    return [];
  }
  const hooks = (parsed as { hooks?: Record<string, unknown> }).hooks ?? {};

  const found: string[] = [];
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups as { hooks?: { command?: string }[] }[]) {
      for (const handler of group?.hooks ?? []) {
        const command = handler?.command;
        if (typeof command !== "string" || !isCompanionCommand(command)) continue;
        if (!found.includes(command)) found.push(command);
      }
    }
  }

  return found;
}

/**
 * Work out what to say.
 *
 * Pure over everything it is given, which is what makes "the doctor changes
 * nothing" a property rather than a promise: there is no filesystem, no socket
 * and no clock reachable from here.
 */
export function diagnose({
  settings,
  unreadable,
  programs,
  exists,
  companion,
  capability,
  settingsPath,
}: DoctorInput): DoctorReport {
  const findings: Finding[] = [];
  const installed = namedPrograms(settings);

  /* -------------------------------------------------------------- 1. the hooks */

  let plan: ReturnType<typeof planHooks> | null = null;
  let planError: string | null = null;
  try {
    plan = planHooks({
      settingsPath,
      relayCommand: programs.programs.relay,
      askCommand: programs.programs.ask,
      current: settings,
    });
  } catch (error) {
    planError = (error as Error).message;
  }

  if (unreadable !== undefined) {
    findings.push({
      severity: "bad",
      subject: "hooks",
      answer: `could not read ${settingsPath}`,
      note: unreadable,
      remedy: "fix that and run this again; nothing here writes to it",
    });
  } else if (planError !== null) {
    findings.push({
      severity: "bad",
      subject: "hooks",
      answer: `${settingsPath} is not settings this can read`,
      note: planError,
      remedy: "nothing was changed; the file is exactly as it is",
    });
  } else if (plan!.unchanged.length === 0 && plan!.unchangedBlocking.length === 0) {
    findings.push({
      severity: "absent",
      subject: "hooks",
      answer: `not installed in ${settingsPath}`,
      remedy: "npm run relay:install -- --dry-run   (shows the change, writes nothing)",
    });
  } else {
    findings.push({
      severity: "ok",
      subject: "hooks",
      answer: `installed in ${settingsPath}`,
      note:
        plan!.unchangedBlocking.length > 0
          ? `the hook that waits for your answer is installed too (${plan!.unchangedBlocking.join(", ")})`
          : `the hook that waits for your answer is NOT installed (${plan!.addedBlocking.join(", ")})`,
      remedy:
        plan!.unchangedBlocking.length > 0
          ? "npm run relay:uninstall:wait   (takes out only the one that waits)"
          : "npm run relay:install -- --wait",
    });
  }

  /* ------------------------------------------- 2 and 3. the programs, and whose */

  const expected = [programs.programs.relay, programs.programs.ask];

  if (installed.length === 0) {
    findings.push({
      severity: "absent",
      subject: "programs in the settings",
      answer: "the settings name no spark program, because no hook is installed",
    });
  }

  for (const command of installed) {
    const there = exists(command);
    const ours = expected.includes(command);
    const what = basename(command);

    if (!there) {
      findings.push({
        severity: "bad",
        subject: `programs: ${what}`,
        answer: `named by the settings, and not on this machine — ${command}`,
        remedy: "npm run relay:install -- --yes   (re-points the hooks at this install)",
      });
    } else if (!ours) {
      findings.push({
        severity: "bad",
        subject: `programs: ${what}`,
        answer: `present, and left over from another install — ${command}`,
        remedy: "npm run relay:install -- --yes   (re-points the hooks at this install)",
      });
    } else {
      findings.push({ severity: "ok", subject: `programs: ${what}`, answer: command });
    }
  }

  // What *this* install would use, whether or not anything points at it. Printed
  // unconditionally: "it would point at a file that is not there" is the answer
  // that stops a person re-running this six times.
  for (const path of expected) {
    if (!exists(path)) {
      findings.push({
        severity: "bad",
        subject: `this install: ${basename(path)}`,
        answer: `not built — ${path}`,
        remedy: "npm run build",
      });
    } else {
      findings.push({ severity: "ok", subject: `this install: ${basename(path)}`, answer: path });
    }
  }

  findings.push({
    severity: "ok",
    subject: "which answer the hooks use",
    answer:
      programs.source === "installed"
        ? `the installed companion's own directory (looked in ${programs.searched.join(", ")})`
        : `this checkout's build output (no installed companion found in ${programs.searched.join(", ")})`,
  });

  /* -------------------------------------------------------- 4. the companion */

  if (companion.address === null) {
    findings.push({
      severity: "absent",
      subject: "companion",
      answer: "this machine has no readable identity to derive the address from",
      note: "that is about the host, not about the product",
    });
  } else if (companion.reachable) {
    findings.push({ severity: "ok", subject: "companion", answer: `listening on ${companion.address}` });
  } else {
    findings.push({
      severity: "absent",
      subject: "companion",
      answer: `nothing is listening on ${companion.address}`,
      note: "that is a report, not a fault: it is what a machine looks like before anything has blocked the agent",
      remedy: "npm run companion",
    });
  }

  /* --------------------------------------------------- 5. the floating surface */

  const persistent = canHoldPersistentSurface(capability);
  findings.push({
    severity: persistent ? "ok" : "absent",
    subject: "floating surface",
    answer: `${persistent ? "yes" : "no"} — asked "${whatWasAsked(capability)}"`,
    note:
      capability === null || capability.placement === "unknown"
        ? "this process has no window behind it, so this says the host could not ask — not that the platform said no"
        : persistent
          ? "so the companion can stay on screen rather than appearing only when something blocks"
          : "so the companion appears when something blocks and is otherwise absent",
    remedy:
      capability !== null && capability.placement !== "unknown" && !persistent
        ? "npm run probe:capability   (the same probe, run where there is a window)"
        : undefined,
  });

  return { findings, broken: findings.some((finding) => finding.severity === "bad") };
}

/** The question the capability report says was asked. Named, never just an answer. */
function whatWasAsked(capability: HostWindow | null): string {
  if (capability === null || capability.placement === "unknown") return "was there a window to ask";
  if (capability.placement === "wayland-layer") return "did the compositor bind a layer surface to it";
  if (capability.placement === "windows-topmost") return "is WS_EX_TOPMOST set on its real handle";
  return "is its window level a floating level";
}

/** The mark a finding is printed with. Readable in a list; colour is not used. */
const MARK: Record<Severity, string> = {
  ok: "  ok  ",
  absent: "  --  ",
  bad: "  !!  ",
};

/** The report, as lines. */
export function render(report: DoctorReport): string[] {
  const lines: string[] = [];
  for (const finding of report.findings) {
    lines.push(`${MARK[finding.severity]} ${finding.subject.padEnd(26)} ${finding.answer}`);
    if (finding.note) lines.push(`      ${" ".repeat(26)} ${finding.note}`);
    if (finding.remedy) lines.push(`      ${" ".repeat(26)} to fix: ${finding.remedy}`);
  }
  lines.push("");
  lines.push(
    report.broken
      ? "Something above is broken. Nothing was written, no hook was installed and no setting was changed."
      : "Nothing is broken. Nothing was written, no hook was installed and no setting was changed."
  );
  return lines;
}

/* ------------------------------------------------------------- the real thing */

/** Whether something is listening at an address, without sending it anything. */
function reachable(address: string): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(address);
    const answer = (yes: boolean): void => {
      clearTimeout(timer);
      socket.destroy();
      done(yes);
    };
    // A doctor that delivered a payload would be a second thing with a second
    // consent model. Connecting and saying nothing is the whole of the check.
    const timer = setTimeout(() => answer(false), 1_000);
    timer.unref();
    socket.once("connect", () => answer(true));
    socket.once("error", () => answer(false));
    socket.end();
  });
}

/** The host's settings as they are now; `""` when there is no file. */
function readSettings(path: string): { settings: string; unreadable?: string } {
  try {
    return { settings: readFileSync(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { settings: "" };
    return { settings: "", unreadable: (error as Error).message };
  }
}

/**
 * Gather what the report needs, then print it.
 *
 * Every effect in this function is a read: a stat, a read, a connect, a query of
 * this process's own globals. Nothing here can write, and
 * `test/doctor.test.ts` holds that by running the real command over a real file
 * and comparing the bytes, the timestamps and the directory.
 */
export async function doctor(): Promise<number> {
  const settingsPath = process.argv[2] ?? USER_SETTINGS_PATH;
  const { settings, unreadable } = readSettings(settingsPath);
  const address = currentCompanionAddress();

  const report = diagnose({
    settings,
    settingsPath,
    ...(unreadable !== undefined ? { unreadable } : {}),
    programs: resolvePrograms(),
    exists: existsSync,
    companion: { address, reachable: address === null ? false : await reachable(address) },
    // The same read the escalation surface does, from the same module. A second
    // probe here would be a second answer about a platform this project has
    // already got wrong once by asking it something it cannot answer.
    capability: readHostWindow(),
  });

  const home = process.env.HOME;
  const where =
    home !== undefined && settingsPath.startsWith(home)
      ? `~${settingsPath.slice(home.length)}`
      : settingsPath;

  process.stdout.write(
    [`spark doctor — ${where}`, "", ...render(report)].join("\n") + "\n"
  );

  // Non-zero only for something broken. A companion that is not running is a
  // state, not a fault, and a tool that exits non-zero for it would make every
  // quiet machine look like a broken one.
  return report.broken ? 1 : 0;
}

/**
 * Run when this file was asked to rather than imported.
 *
 * The guard is what lets `test/doctor.test.ts` import `diagnose` and drive it
 * over settings written by hand, including settings nobody would want a real
 * machine to have.
 */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await doctor();
}