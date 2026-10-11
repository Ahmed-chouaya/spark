import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  HOOK_EVENTS,
  backupPathFor,
  installHooks,
  planHooks,
  uninstallHooks,
} from "../src/relay/install";

/**
 * Installing hooks into the host agent's own configuration.
 *
 * Every test writes to a real file in a real directory and reads it back. The
 * requirements here are about what is on disk after a sequence of operations —
 * "declining leaves the file exactly as it was" is a claim about bytes — and a
 * mocked filesystem cannot answer any of them.
 *
 * The settings file belongs to the user, so nothing in this file points at
 * `~/.claude/settings.json`.
 */

const RELAY = "/opt/spark/spark-relay";

let directory: string;
let settingsPath: string;
let counter = 0;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "spark-hooks-"));
  settingsPath = join(directory, "settings.json");
});

/** A fixed clock, so a backup is named by the test rather than by the wall. */
const at = (second: number): (() => Date) => () => new Date(`2026-10-11T09:00:0${second}.000Z`);

const write = (contents: unknown): void => {
  writeFileSync(
    settingsPath,
    typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`
  );
};

const read = (): string => readFileSync(settingsPath, "utf8");

/** Every hook command in the file, for every event. */
const commandsIn = (settings: unknown): string[] => {
  const hooks = (settings as { hooks?: Record<string, unknown> }).hooks ?? {};
  return Object.values(hooks).flatMap((groups) =>
    (groups as Array<{ hooks?: Array<{ command?: string }> }>).flatMap((group) =>
      (group?.hooks ?? []).map((handler) => handler?.command ?? "")
    )
  );
};

const parse = (text: string): Record<string, unknown> => JSON.parse(text);

describe("nothing is installed until it is asked for", () => {
  it("leaves the configuration untouched with no explicit request", async () => {
    write({ theme: "dark" });
    const before = read();

    // Planning is the whole of what happens before consent, and it writes
    // nothing under any circumstance — it is a pure function of the file.
    const plan = planHooks({ settingsPath, relayCommand: RELAY, current: before });
    expect(plan.changed).toBe(true);
    expect(plan.added).toEqual([...HOOK_EVENTS]);
    expect(read()).toBe(before);

    const result = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: false,
      now: at(1),
    });

    expect(result.applied).toBe(false);
    if (result.applied) throw new Error("declining must not write");
    expect(result.reason).toBe("not-confirmed");
    // Not even a backup: a declined install leaves the machine as it was, and
    // a stray backup file would be a change nobody asked for.
    expect(result.backupPath).toBeNull();
    expect(existsSync(join(directory, "spark-backups"))).toBe(false);
    expect(read()).toBe(before);
  });

  it("creates no file at all where there was none", async () => {
    const result = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: false,
      now: at(1),
    });

    expect(result.applied).toBe(false);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("makes no change to the host's configuration when it does write", async () => {
    write({ theme: "dark", permissions: { allow: ["Bash(ls:*)"] } });
    const before = read();

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(1) });
    const after = parse(read());

    // Everything that was there is still there. The hooks key is added beside
    // the user's own settings rather than in place of them.
    expect(after.theme).toBe("dark");
    expect(after.permissions).toEqual({ allow: ["Bash(ls:*)"] });
  });
});

describe("the proposal is shown before anything is written", () => {
  it("carries the change as a diff of the file itself", () => {
    write({});
    const plan = planHooks({
      settingsPath,
      relayCommand: RELAY,
      current: read(),
    });

    expect(plan.diff).toContain("--- ");
    expect(plan.diff).toContain("+++ ");
    for (const event of HOOK_EVENTS) {
      expect(plan.diff, event).toContain(`+    "${event}"`);
    }
  });

  it("declining leaves the file exactly as it was, byte for byte", async () => {
    // Deliberately not the formatter's output — a file with odd spacing and no
    // final newline, which is what a hand-edited one looks like. "Exactly as it
    // was" has to mean the bytes, not the parsed structure.
    write('{  "theme":   "dark",\n  "hooks": { "Stop": [ { "matcher": "*", "hooks": [] } ] }\n}');

    const before = read();
    const declined = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: false,
      now: at(1),
    });

    expect(declined.applied).toBe(false);
    expect(read()).toBe(before);
    expect(readFileSync(settingsPath).length).toBe(Buffer.byteLength(before));
  });

  it("proposes exactly what it would write", () => {
    write({ theme: "dark" });
    const plan = planHooks({ settingsPath, relayCommand: RELAY, current: read() });

    write(plan.proposed);
    expect(read()).toBe(plan.proposed);
  });
});

describe("the previous configuration is recoverable", () => {
  it("backs the file up before changing it", async () => {
    write({ theme: "dark" });
    const before = read();

    const result = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: true,
      now: at(2),
    });

    expect(result.applied).toBe(true);
    const backupPath =
      result.applied === true ? result.backupPath : backupPathFor(settingsPath, new Date());
    expect(existsSync(backupPath)).toBe(true);
    // The backup is the file as it was, not the file as it will be.
    expect(readFileSync(backupPath, "utf8")).toBe(before);
    expect(read()).not.toBe(before);
  });

  it("names the backup for what is in it, beside the file it protects", () => {
    const path = backupPathFor("/home/someone/.claude/settings.json", new Date("2026-10-11T09:00:05Z"));

    expect(path).toBe(
      "/home/someone/.claude/spark-backups/settings.json.2026-10-11T09-00-05-000Z.bak"
    );
  });

  it("backs up again on a second install that has work to do", async () => {
    write({ theme: "dark" });
    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(3) });
    const afterFirst = read();

    // Someone edits the file and takes one of the companion's hooks out. Now the
    // next install has something to do, and so is a real install.
    const edited = parse(afterFirst) as { theme?: unknown; hooks: Record<string, unknown[]> };
    edited.theme = "light";
    edited.hooks.Stop = [];
    write(edited);

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(4) });
    expect(commandsIn(parse(read())).filter((c) => c === RELAY)).toHaveLength(
      HOOK_EVENTS.length
    );

    // One backup per install, and each holds the state as it was before *that*
    // install. A single backup would only ever let you undo the most recent
    // change, which is the one you are least likely to want undone.
    const first = backupPathFor(settingsPath, new Date("2026-10-11T09:00:03.000Z"));
    const second = backupPathFor(settingsPath, new Date("2026-10-11T09:00:04.000Z"));

    // Before the first: no hooks at all.
    expect(parse(readFileSync(first, "utf8"))).toEqual({ theme: "dark" });
    // Before the second: the edit that was made, hook and all.
    expect(parse(readFileSync(second, "utf8"))).toEqual(edited);
  });

  it("takes no backup when there is nothing to write", async () => {
    write({ theme: "dark" });
    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(3) });

    // Already installed: the file already says what it would say, so it is not
    // rewritten and there is nothing to undo.
    const again = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: true,
      now: at(4),
    });

    expect(again.applied).toBe(false);
    expect(
      existsSync(backupPathFor(settingsPath, new Date("2026-10-11T09:00:04.000Z")))
    ).toBe(false);
  });
});

describe("hooks that were already there survive", () => {
  it("keeps a pre-existing hook the companion did not add", async () => {
    write({
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/usr/local/bin/audit-bash" }],
          },
        ],
      },
    });

    const plan = planHooks({ settingsPath, relayCommand: RELAY, current: read() });
    // Counted before anything is written, so "preserved" is a statement about
    // the merge rather than a hope about it.
    expect(plan.preserved.PreToolUse).toBe(1);

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(5) });
    const hooks = (parse(read()).hooks ?? {}) as Record<string, unknown>;
    const commands = commandsIn(parse(read()));

    expect(commands).toContain("/usr/local/bin/audit-bash");
    expect(commands).toContain(RELAY);
    // Still under its own matcher group, not folded into ours.
    const preToolUse = (hooks.PreToolUse ?? []) as Array<{
      matcher?: string;
      hooks?: Array<{ command?: string }>;
    }>;
    expect(preToolUse[0]?.matcher).toBe("Bash");
    expect(preToolUse[0]?.hooks?.[0]?.command).toBe("/usr/local/bin/audit-bash");
  });

  it("keeps hooks on events the companion does not install for", async () => {
    write({
      hooks: {
        // Not one of ours, and not one we touch.
        SessionEnd: [
          { matcher: "*", hooks: [{ type: "command", command: "/usr/local/bin/cleanup" }] },
        ],
      },
    });

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(6) });

    expect(commandsIn(parse(read()))).toContain("/usr/local/bin/cleanup");
  });

  it("keeps settings the companion has no opinion about", async () => {
    write({
      model: "opus",
      env: { FOO: "bar" },
      statusLine: { type: "command", command: "my-status" },
      hooks: {
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: "mine" }] }],
      },
    });

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(7) });
    const after = parse(read());

    expect(after.model).toBe("opus");
    expect(after.env).toEqual({ FOO: "bar" });
    expect(after.statusLine).toEqual({ type: "command", command: "my-status" });
  });

  it("refuses to touch a file it cannot read", async () => {
    write("{ this is not settings json");

    // Overwriting a file because its contents could not be understood is how a
    // user's agent configuration disappears.
    await expect(
      installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(8) })
    ).rejects.toThrow(/not valid settings JSON/);
    expect(read()).toBe("{ this is not settings json");
  });
});

describe("installing twice does not double up", () => {
  it("leaves one copy of each companion hook", async () => {
    const first = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: true,
      now: at(9),
    });
    expect(first.applied).toBe(true);
    const afterFirst = read();

    const second = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: true,
      now: at(10),
    });

    // Already there, so there is nothing to do and the file is not rewritten.
    expect(second.applied).toBe(false);
    if (second.applied) throw new Error("a repeat install must not write");
    expect(second.reason).toBe("nothing-to-do");
    expect(second.backupPath).toBeNull();
    expect(read()).toBe(afterFirst);

    const commands = commandsIn(parse(read()));
    for (const event of HOOK_EVENTS) {
      const hooks = (parse(read()).hooks ?? {}) as Record<string, unknown>;
      const groups = hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>;
      const copies = groups
        .flatMap((group) => group?.hooks ?? [])
        .filter((handler) => handler.command === RELAY).length;
      expect(copies, event).toBe(1);
    }
    expect(commands.filter((command) => command === RELAY)).toHaveLength(HOOK_EVENTS.length);
  });

  it("is idempotent over many installs, and over an existing hook of ours", async () => {
    for (let i = 0; i < 5; i++) {
      await installHooks({
        settingsPath,
        relayCommand: RELAY,
        confirmed: true,
        now: at(i % 9),
      });
    }

    const first = read();
    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(1) });
    expect(read()).toBe(first);
  });

  it("tells a repeat install from a first one in the plan", () => {
    const plan = planHooks({ settingsPath, relayCommand: RELAY, current: "" });
    expect(plan.added).toEqual([...HOOK_EVENTS]);
    expect(plan.unchanged).toEqual([]);

    const again = planHooks({ settingsPath, relayCommand: RELAY, current: plan.proposed });
    expect(again.added).toEqual([]);
    expect(again.unchanged).toEqual([...HOOK_EVENTS]);
    expect(again.changed).toBe(false);
  });
});

describe("uninstalling returns the host to where it was", () => {
  it("removes the companion's hooks and leaves the rest", async () => {
    write({
      theme: "dark",
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/audit" }] },
        ],
      },
    });
    const before = read();

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(2) });
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    const after = parse(read()) as { theme?: unknown; hooks?: Record<string, unknown[]> };
    expect(commandsIn(after)).toEqual(["/usr/local/bin/audit"]);
    expect(after.theme).toBe("dark");
    expect(after.hooks?.PreToolUse).toHaveLength(1);
    // Structurally the same hooks as before, even though the bytes differ —
    // this module rewrites a file it did not write.
    expect(JSON.stringify(parse(read()).hooks)).toBe(JSON.stringify(parse(before).hooks));
  });

  it("removes the events key when the companion added all of it", async () => {
    write({ theme: "dark" });

    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(3) });
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    expect(parse(read()).hooks).toBeUndefined();
    expect(parse(read()).theme).toBe("dark");
  });

  it("leaves the backup recoverable after uninstalling", async () => {
    write({ theme: "dark" });
    const before = read();

    const installed = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      confirmed: true,
      now: at(4),
    });
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    // Uninstalling removes the hooks; it does not discard the way back. If a
    // user later wants the file as it was rather than as we left it, it is there.
    const backupPath =
      installed.applied === true
        ? installed.backupPath
        : backupPathFor(settingsPath, new Date("2026-10-11T09:00:04.000Z"));
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, "utf8")).toBe(before);
  });

  it("changes nothing when the companion was never installed", async () => {
    write({ theme: "dark" });
    const before = read();

    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    expect(read()).toBe(before);
  });
});

describe("what gets installed", () => {
  it("installs exactly the events the adapter models", () => {
    // A hook for an event the adapter does not translate would cost the user a
    // process spawn per occurrence and be discarded on arrival.
    expect([...HOOK_EVENTS]).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PostToolUseFailure",
      "Notification",
      "Stop",
    ]);
  });

  it("installs a non-blocking command hook, in exec form", async () => {
    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(5) });

    const hooks = (parse(read()).hooks ?? {}) as Record<
      string,
      Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>
    >;
    const handler = hooks.SessionStart?.[0]?.hooks?.[0];

    // Exec form with no arguments: the relay is spawned directly, with no shell
    // to tokenise a path and no shell to go missing at hook time.
    expect(handler).toEqual({ type: "command", command: RELAY, args: [] });
    // Every occurrence, so no session is missed.
    expect(hooks.SessionStart?.[0]?.matcher).toBe("*");
  });

  it("installs nothing that could block the host's operation", async () => {
    await installHooks({ settingsPath, relayCommand: RELAY, confirmed: true, now: at(6) });

    const hooks = (parse(read()).hooks ?? {}) as Record<
      string,
      Array<{ hooks?: Array<Record<string, unknown>> }>
    >;
    for (const [event, groups] of Object.entries(hooks)) {
      for (const group of groups) {
        for (const handler of group?.hooks ?? []) {
          // No timeout long enough to matter, and nothing that decides: the
          // relay returns no decision, so the host's own permission flow is
          // untouched. Blocking hooks are a separate change.
          expect(handler, event).not.toHaveProperty("permissionDecision");
          expect(handler.timeout ?? 600, event).toBeLessThanOrEqual(600);
        }
      }
    }
  });
});