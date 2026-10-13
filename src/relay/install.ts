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
 * and decides nothing, so it cannot hold the host's operation open.
 *
 * The one exception is `PreToolUse`, which is here **and** in
 * `BLOCKING_HOOK_EVENTS`. It appears in both because the two programs are
 * installed for the same event and deliberately live in different matcher groups:
 * the relay announces the tool call, and the waiting program asks the user about
 * it. Merging them into one handler would mean one program doing two jobs, and
 * the program that waits would be started for events it has nothing to ask about.
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

/**
 * The events the *waiting* program is installed for.
 *
 * Exactly one, and it is the only event where the host has asked a question this
 * companion can answer. The host fires `PreToolUse` before every tool call, and a
 * user who has approved everything by hand does not need a mascot asking about
 * each one — so the waiting hook is installed on its own, and can be removed on
 * its own, without losing the mascot.
 *
 * A user who wants the mascot without the wait should be able to have exactly
 * that. Asking them to also give up the companion would be the wrong trade, and it
 * is the trade a single merged hook would force on them.
 */
export const BLOCKING_HOOK_EVENTS = ["PreToolUse"] as const;

export type BlockingHookEvent = (typeof BLOCKING_HOOK_EVENTS)[number];

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
  /**
   * The waiting executable, as the host will invoke it.
   *
   * Optional, and omitting it installs no waiting hook — which is what a caller
   * that has not built or does not want the wait should do. Present, it adds one
   * hook on one event, in its own matcher group, removable on its own.
   */
  readonly askCommand?: string;
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
  /** Events that would gain the *waiting* hook. Empty unless it was asked for. */
  readonly addedBlocking: readonly BlockingHookEvent[];
  /** Events that already have the waiting hook, and so would gain nothing. */
  readonly unchangedBlocking: readonly BlockingHookEvent[];
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
  askCommand,
}: PlanOptions): HookPlan {
  const settings = parse(current, settingsPath);
  const hooks = { ...(settings.hooks ?? {}) };

  const added: HookEvent[] = [];
  const unchanged: HookEvent[] = [];
  const preserved: Record<string, number> = {};
  const addedBlocking: BlockingHookEvent[] = [];
  const unchangedBlocking: BlockingHookEvent[] = [];

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

  // The waiting program, and only where it was asked for.
  //
  // Without `askCommand` this loop does nothing at all, which is what makes the
  // non-blocking install usable on its own: a caller that knows nothing about
  // waiting produces the file it produced before this change existed, byte for
  // byte. That is also what `test/relay-install.test.ts` pins, and it is the
  // reason the option is optional rather than required — requiring it would make
  // every existing caller change for a program that may not be installed.
  if (askCommand !== undefined) {
    for (const event of BLOCKING_HOOK_EVENTS) {
      const groups = asGroups(hooks[event]);

      // Counted against the relay rather than the asker, so a user who already
      // has the non-blocking hook installed is not told their configuration was
      // rewritten: the waiting group is an addition to the same event, and the
      // handlers already there are still there.
      preserved[event] = countForeign(groups, askCommand);

      if (countOwn(groups, askCommand) > 0) {
        unchangedBlocking.push(event);
        continue;
      }

      // A separate matcher group rather than the same one, so removing the wait
      // removes exactly the group that runs the waiting program and leaves the
      // group running the relay in place. One group holding both would make the
      // two inseparable in the one place a user can act on them.
      hooks[event] = [...groups, ownGroup(askCommand)];
      addedBlocking.push(event);
    }
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
    addedBlocking,
    unchangedBlocking,
    diff: unifiedDiff(current, proposed, settingsPath),
  };
}

export interface InstallOptions {
  /** The settings file to change. */
  readonly settingsPath?: string;
  /** The relay executable, as the host will invoke it. */
  readonly relayCommand: string;
  /**
   * The waiting executable, as the host will invoke it.
   *
   * Omitted, and no waiting hook is installed. Present, and one is added on one
   * event in its own matcher group, which `uninstallHooks` can take back out
   * without touching the non-blocking hooks.
   */
  readonly askCommand?: string;
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
  askCommand,
  confirmed,
  now = () => new Date(),
}: InstallOptions): Promise<InstallResult> {
  const current = await readIfPresent(settingsPath);
  const plan = planHooks({ settingsPath, relayCommand, askCommand, current });

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
  return removeCommands({ settingsPath }, [relayCommand]);
}

/**
 * Take out only the waiting hook, leaving every non-blocking hook in place.
 *
 * A separate function rather than a flag on `uninstallHooks`, and the reason is
 * that "remove the wait" and "remove everything" are different things a user can
 * mean. One of them is somebody who has finished using this and wants their
 * configuration back exactly as it was; the other is somebody who liked the
 * mascot and found the wait not for them. Overloading one function with an
 * optional command makes the second mean the first whenever it is called with
 * both, which is precisely the call `relay:uninstall` makes.
 *
 * Named after what it removes rather than taking a boolean, so the call site says
 * which of the two things it means.
 */
export async function uninstallWait({
  settingsPath = USER_SETTINGS_PATH,
  askCommand,
}: {
  readonly settingsPath?: string;
  /** The waiting executable, as it was installed. */
  readonly askCommand: string;
}): Promise<UninstallResult> {
  return removeCommands({ settingsPath }, [askCommand]);
}

/**
 * Remove the matcher groups running any of `commands`, and nothing else.
 *
 * Shared by the two public removals above, and the reason they can be separate
 * is that a group is identified by the command it runs: removing "the group
 * running this program" is exact, where removing "the wait" as a concept would
 * have to guess which lines belong to it.
 */
async function removeCommands(
  { settingsPath = USER_SETTINGS_PATH }: { readonly settingsPath?: string },
  commands: readonly string[]
): Promise<UninstallResult> {
  const before = await readIfPresent(settingsPath);
  const settings = parse(before, settingsPath);
  const hooks = { ...(settings.hooks ?? {}) };

  for (const event of HOOK_EVENTS) {
    const groups = asGroups(hooks[event]);
    const remaining = groups.filter(
      (group) => !commands.some((command) => countOwn([group], command) > 0)
    );
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