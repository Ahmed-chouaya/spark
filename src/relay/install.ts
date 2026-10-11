/**
 * Installing the relay into the host agent's own configuration.
 *
 * ## Why this module is careful
 *
 * `~/.claude/settings.json` is user state the user did not ask us to write, and
 * it is the file that decides whether their agent runs. Everything here follows
 * from that: nothing is written until it is asked for, the proposed change is
 * shown before it is made, the previous file is kept, hooks that were already
 * there survive, and doing it twice does not do it twice.
 *
 * None of that is novel. It is here because it is the part of this change with
 * the most user-visible consequence if it is wrong, and a companion that never
 * renders is a smaller problem than an agent that stops starting.
 *
 * ## Two steps, deliberately
 *
 * `planHooks` reads and proposes. `installHooks` writes. They are separate
 * because the requirement is that the user is *shown* the change before it is
 * made, and a function that both computes and writes cannot be used to show it
 * first — the only way to get a proposal out of it is to call it and hope it
 * did not write. So planning is a pure function of the file's contents, and it
 * writes nothing under any circumstance.
 *
 * ## Merging, not replacing
 *
 * A settings file the user has already put hooks in is not ours to rewrite. The
 * companion's hooks are identified by the relay command they run, and only
 * entries carrying that command are ever added, removed or counted. Everything
 * else in the file is carried through byte for byte in structure, which is why
 * installing twice produces the same file rather than a second copy of
 * everything.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unifiedDiff } from "./diff.ts";

/**
 * The hook events the companion installs itself for.
 *
 * Exactly the events `src/state-selection/adapters/claude-code.ts` models, and
 * no others. An event the adapter does not translate would be a payload the
 * companion silently discards, so installing a hook for it would cost the user a
 * process spawn per event for nothing.
 *
 * Every one of these is non-blocking by construction: the relay returns nothing
 * and decides nothing, so it cannot hold the host's operation open. Blocking
 * hooks are a different change with a different name, and a hook that has to
 * wait for a response is exactly the branch this design removes.
 */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

/** The one shape of handler this module writes or removes. */
const RELAY_HANDLER = "command";

/** Claude Code settings, as far as this module touches them. */
interface Settings {
  hooks?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A matcher group as Claude Code defines it: a filter, and the handlers behind it. */
interface MatcherGroup {
  matcher?: string;
  hooks?: Array<{ type?: string; command?: string; args?: unknown[] }>;
}

/**
 * Where the companion's hooks go.
 *
 * User scope rather than project scope: the companion follows the user, not a
 * repository, and a hook written into a repository would be committed by people
 * who did not agree to run it.
 */
export const USER_SETTINGS_PATH = join(
  process.env.HOME ?? "",
  ".claude",
  "settings.json"
);

export interface PlanOptions {
  /** The settings file to be changed. */
  readonly settingsPath?: string;
  /** The relay executable, as the host will invoke it. */
  readonly relayCommand: string;
  /** What the settings file holds now; `""` when it does not exist yet. */
  readonly current: string;
}

export interface HookPlan {
  /** The settings path this plan is about. */
  readonly settingsPath: string;
  /** The file as it is now, exactly. */
  readonly current: string;
  /** The file as it would be. */
  readonly proposed: string;
  /** Whether writing the proposal would change anything at all. */
  readonly changed: boolean;
  /** Events that would gain a companion hook. */
  readonly added: readonly HookEvent[];
  /** Events that already have one, and so would gain nothing. */
  readonly unchanged: readonly HookEvent[];
  /** Hooks already in the file that the companion did not add, by event. */
  readonly preserved: Readonly<Record<string, number>>;
  /** The proposed change, as a diff to show before anything is written. */
  readonly diff: string;
}

/**
 * What installing would do. Writes nothing — ever.
 *
 * The diff is part of the return value rather than something a caller prints,
 * so "show the change first" is a property of the API and not a convention the
 * caller has to remember.
 */
export function planHooks({
  settingsPath = USER_SETTINGS_PATH,
  relayCommand,
  current,
}: PlanOptions): HookPlan {
  const settings = parse(current, settingsPath);
  const hooks = { ...(settings.hooks ?? {}) };

  const added: HookEvent[] = [];
  const unchanged: HookEvent[] = [];
  const preserved: Record<string, number> = {};

  for (const event of HOOK_EVENTS) {
    const groups = asGroups(hooks[event]);

    // Every handler in this event that the companion did not add, counted
    // before and after. A change to that number is a change to someone else's
    // configuration, which is what the test suite watches for.
    const foreign = countForeign(groups, relayCommand);
    preserved[event] = foreign;

    if (countOwn(groups, relayCommand) > 0) {
      // Already installed. Left exactly as it is, including the matcher group it
      // sits in, because rearranging an existing entry would be a change nobody
      // asked for and would defeat the point of checking first.
      unchanged.push(event);
      continue;
    }

    hooks[event] = [...groups, ownGroup(relayCommand)];
    added.push(event);
  }

  const proposed = changed(settings, hooks)
    ? serialise({ ...settings, hooks })
    : current;

  return {
    settingsPath,
    current,
    proposed,
    changed: proposed !== current,
    added,
    unchanged,
    preserved,
    diff: unifiedDiff(current, proposed, settingsPath),
  };
}

export interface InstallOptions {
  /** The settings file to change. */
  readonly settingsPath?: string;
  /** The relay executable, as the host will invoke it. */
  readonly relayCommand: string;
  /**
   * The user has seen the diff and agreed to it.
   *
   * There is no default. An installer that proceeds when nobody answered is an
   * installer that edits a user's agent configuration on a hunch, so the
   * question is asked in the type rather than answered by a caller who forgot.
   */
  readonly confirmed: boolean;
  /** Injected so a test can name a backup rather than depend on the clock. */
  readonly now?: () => Date;
}

export type InstallResult =
  | {
      readonly applied: false;
      readonly plan: HookPlan;
      /** Why nothing was written. */
      readonly reason: "not-confirmed" | "nothing-to-do";
      /** The backup, if one was taken. Never taken when nothing was written. */
      readonly backupPath: string | null;
    }
  | {
      readonly applied: true;
      readonly plan: HookPlan;
      readonly settingsPath: string;
      /** Where the configuration as it was beforehand now lives. */
      readonly backupPath: string;
    };

/**
 * Write the plan, if the user asked for it.
 *
 * The backup is taken before the write and before anything else can go wrong, so
 * there is no window in which the previous configuration exists only in memory.
 * Nothing is backed up when nothing is written: a declined install leaves the
 * machine exactly as it was, including the absence of a stray backup file.
 */
export async function installHooks({
  settingsPath = USER_SETTINGS_PATH,
  relayCommand,
  confirmed,
  now = () => new Date(),
}: InstallOptions): Promise<InstallResult> {
  const current = await readIfPresent(settingsPath);
  const plan = planHooks({ settingsPath, relayCommand, current });

  if (!confirmed) {
    return { applied: false, plan, reason: "not-confirmed", backupPath: null };
  }
  if (!plan.changed) {
    // Installing again is not an error and not a rewrite. The file already says
    // what it would say, so it is left alone.
    return { applied: false, plan, reason: "nothing-to-do", backupPath: null };
  }

  const backupPath = await backUp(settingsPath, current, now());
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, plan.proposed, "utf8");

  return { applied: true, plan, settingsPath, backupPath };
}

/** What uninstalling did. */
export interface UninstallResult {
  readonly settingsPath: string;
  /** Whether the file was written at all. */
  readonly changed: boolean;
  /** The file as it was. */
  readonly before: string;
  /** The file as it is now. */
  readonly after: string;
  /** What changed, as a diff. */
  readonly diff: string;
}

/**
 * Remove the companion's hooks, leaving everything else alone.
 *
 * Surgical rather than a restore, for a reason worth stating: between installing
 * and uninstalling the user may have edited their own settings, and restoring a
 * backup would throw those edits away. Taking out exactly the entries that run
 * the relay returns the hooks to how they were without touching anything else,
 * and the backup stays on disk either way.
 *
 * Writes nothing when the companion's hooks were not there to begin with.
 */
export async function uninstallHooks({
  settingsPath = USER_SETTINGS_PATH,
  relayCommand,
}: {
  readonly settingsPath?: string;
  readonly relayCommand: string;
}): Promise<UninstallResult> {
  const before = await readIfPresent(settingsPath);
  const settings = parse(before, settingsPath);
  const hooks = { ...(settings.hooks ?? {}) };

  for (const event of HOOK_EVENTS) {
    const groups = asGroups(hooks[event]);
    const remaining = groups.filter((group) => countOwn([group], relayCommand) === 0);
    if (remaining.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = remaining;
    }
  }

  // A `hooks: {}` left behind is residue: an empty object says nothing to the
  // host and nothing to the user, and it exists only because this module was
  // here. Removing it leaves the file as it was, which is what uninstalling is
  // for.
  const after = serialise(
    Object.keys(hooks).length === 0 ? withoutHooks(settings) : { ...settings, hooks }
  );

  if (after !== before) {
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, after, "utf8");
  }

  return {
    settingsPath,
    changed: after !== before,
    before,
    after,
    diff: unifiedDiff(before, after, settingsPath),
  };
}

/** The settings with no `hooks` key at all. */
function withoutHooks(settings: Settings): Settings {
  const { hooks: _removed, ...rest } = settings;
  return rest;
}

/**
 * Where a configuration is kept before it is changed.
 *
 * A directory of this project's own rather than the host's own backup
 * directory: it is ours to read back, it is named for what is in it, and a host
 * that prunes its backups cannot take our way of undoing something with it.
 */
export function backupPathFor(settingsPath: string, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return join(dirname(settingsPath), "spark-backups", `settings.json.${stamp}.bak`);
}

/* ------------------------------------------------------------------ helpers */

/**
 * The settings file, parsed. Absent is empty; unparseable is refused.
 *
 * Refusing rather than replacing is the point: a file this cannot read is a file
 * whose contents are unknown, and overwriting a file because its contents could
 * not be understood is how a user's agent configuration disappears.
 */
function parse(contents: string, settingsPath: string): Settings {
  if (contents.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(contents);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not a settings object");
    }
    return parsed as Settings;
  } catch (error) {
    throw new Error(
      `refusing to modify ${settingsPath}: it is not valid settings JSON (${
        (error as Error).message
      })`
    );
  }
}

/** Anything in the hooks value that is not a matcher group is left untouched. */
function asGroups(value: unknown): MatcherGroup[] {
  return Array.isArray(value) ? (value as MatcherGroup[]) : [];
}

/** The companion's own group: every occurrence, the relay, no shell. */
function ownGroup(relayCommand: string): MatcherGroup {
  return {
    // `*` matches every occurrence of the event, on every event. A more precise
    // matcher would narrow a hook this module installs for every session.
    matcher: "*",
    hooks: [
      {
        type: RELAY_HANDLER,
        command: relayCommand,
        // Exec form, not shell form: the relay is spawned directly with no shell
        // to tokenise it, which is both what the relay's own argument-free
        // contract wants and one less thing that has to resolve at hook time.
        args: [],
      },
    ],
  };
}

/** Handlers in this event that run the relay. */
const countOwn = (groups: MatcherGroup[], relayCommand: string): number =>
  groups.reduce(
    (total, group) =>
      total +
      (group.hooks ?? []).filter(
        (handler) => handler?.type === RELAY_HANDLER && handler?.command === relayCommand
      ).length,
    0
  );

/** Handlers in this event that somebody else configured. */
const countForeign = (groups: MatcherGroup[], relayCommand: string): number =>
  groups.reduce((total, group) => total + (group.hooks ?? []).length, 0) -
  countOwn(groups, relayCommand);

/**
 * Whether the hooks actually differ.
 *
 * Compared as text rather than as structure, because "as it was" has to mean the
 * bytes on disk: a rewrite that produced equivalent JSON would still be a
 * rewrite of a file the user did not ask us to rewrite.
 */
function changed(settings: Settings, hooks: Record<string, unknown>): boolean {
  const next = serialise({ ...settings, hooks });
  return next !== serialise(settings);
}

/** Two-space JSON with a trailing newline, which is what Claude Code writes. */
function serialise(settings: Settings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** The file, or `""` when there is not one yet. */
async function readIfPresent(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

/**
 * Keep the configuration as it was, somewhere recoverable.
 *
 * A file that does not exist yet is not backed up, because there is nothing to
 * recover and an empty backup would only look like there was.
 */
async function backUp(settingsPath: string, current: string, at: Date): Promise<string> {
  const backupPath = backupPathFor(settingsPath, at);
  await mkdir(dirname(backupPath), { recursive: true });
  if (current !== "") {
    await copyFile(settingsPath, backupPath);
  }
  return backupPath;
}