import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLOCKING_HOOK_EVENTS,
  installHooks,
  planHooks,
  uninstallHooks,
  uninstallWait,
} from "../src/relay/install.ts";

/**
 * Installing the wait, and taking it back out again.
 *
 * The property under test throughout is **separability**. The companion's mascot
 * and the companion's ability to ask the user a question are two different things,
 * and a user who wants one should not be forced to give up the other. So the
 * blocking hook is installed on its own, in its own matcher group, and removed on
 * its own — and every test here is really about whether that stays true.
 *
 * The fail-open behaviour of the program itself is not tested here; that lives in
 * `ask.test.ts`, against the real binary. This file is about the configuration.
 */

const RELAY = "/opt/spark/spark-relay";
const ASK = "/opt/spark/spark-ask";

let workspace: string;
let settingsPath: string;
let beforeInstall: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "spark-install-"));
  settingsPath = join(workspace, ".claude", "settings.json");
  beforeInstall = JSON.stringify(
    { $schema: "https://json.schemastore.org/claude-code-settings.json" },
    null,
    2
  );
  // The directory made here rather than by the module under test: a test that
  // seeds its own fixture is not testing whether the installer creates it, and
  // `installHooks` does create it — that is covered where it belongs.
  mkdirSync(join(workspace, ".claude"), { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

const current = (): string => readFileSync(settingsPath, "utf8");

/** What the file says about hooks, read back rather than trusted. */
const hookEventsIn = (json: string): Record<string, unknown> =>
  (JSON.parse(json).hooks ?? {}) as Record<string, unknown>;

/** Every command appearing in any hook, as a flat list. */
const commandsIn = (json: string): string[] => {
  const events = hookEventsIn(json);
  const found: string[] = [];
  for (const groups of Object.values(events)) {
    for (const group of groups as Array<{ hooks?: Array<{ command?: string }> }>) {
      for (const handler of group.hooks ?? []) {
        if (handler.command) found.push(handler.command);
      }
    }
  }
  return found;
};

describe("the wait is installed only when it is asked for", () => {
  it("installs no blocking hook when no waiting program is given", () => {
    // The default. A caller that knows nothing about waiting produces the file it
    // produced before waiting existed — which is what makes the mascot usable on
    // its own, and what keeps every pre-existing install test valid.
    const plan = planHooks({
      relayCommand: RELAY,
      current: beforeInstall,
    });

    expect(plan.addedBlocking).toEqual([]);
    expect(commandsIn(plan.proposed)).not.toContain(ASK);
    expect(commandsIn(plan.proposed)).toContain(RELAY);
  });

  it("installs one when it is", () => {
    const plan = planHooks({
      relayCommand: RELAY,
      askCommand: ASK,
      current: beforeInstall,
    });

    expect(plan.addedBlocking).toEqual([...BLOCKING_HOOK_EVENTS]);
    expect(commandsIn(plan.proposed)).toContain(ASK);
  });

  it("writes nothing without an explicit confirmation, wait or not", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);

    const declined = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: false,
    });

    expect(declined.applied).toBe(false);
    expect(current()).toBe(beforeInstall);
  });

  it("shows both programs in the diff before anything is written", () => {
    const plan = planHooks({
      relayCommand: RELAY,
      askCommand: ASK,
      current: beforeInstall,
    });

    // The user consents to a diff, so a program they were not expecting cannot
    // arrive quietly in it.
    expect(plan.diff).toContain(RELAY);
    expect(plan.diff).toContain(ASK);
  });

  it("leaves the file exactly as it was when declined, wait or not", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);

    await installHooks({ settingsPath, relayCommand: RELAY, askCommand: ASK, confirmed: false });

    expect(current()).toBe(beforeInstall);
  });
});

describe("the wait is in its own group, so it can be taken out on its own", () => {
  it("puts the two programs in different matcher groups on the same event", () => {
    const plan = planHooks({
      relayCommand: RELAY,
      askCommand: ASK,
      current: beforeInstall,
    });

    // One group would make the two inseparable in the only place a user can act
    // on them: the settings file.
    const groups = hookEventsIn(plan.proposed)["PreToolUse"] as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    const commandsByGroup = groups.map((group) => group.hooks?.[0]?.command);

    expect(new Set(commandsByGroup).size).toBe(commandsByGroup.length);
    expect(commandsByGroup).toContain(RELAY);
    expect(commandsByGroup).toContain(ASK);
  });

  it("removes only the wait when only the wait is named", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);
    await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });

    await uninstallWait({ settingsPath, askCommand: ASK });

    // This is the test the whole separability design exists for: a user who wants
    // the mascot without the wait keeps the mascot.
    expect(commandsIn(current())).not.toContain(ASK);
    expect(commandsIn(current())).toContain(RELAY);
  });

  it("leaves the non-blocking hooks byte-identical after removing the wait", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);
    await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });
    const bothInstalled = hookEventsIn(current());

    await uninstallWait({ settingsPath, askCommand: ASK });
    const waitRemoved = hookEventsIn(current());

    // Every event except the one they share is untouched, and the shared one
    // keeps exactly the relay's group.
    for (const event of Object.keys(bothInstalled)) {
      if (event === "PreToolUse") continue;
      expect(waitRemoved[event]).toEqual(bothInstalled[event]);
    }

    const groups = waitRemoved["PreToolUse"] as Array<{
      hooks?: Array<{ command?: string }>;
    }>;
    expect(groups).toHaveLength(1);
    expect(groups[0]?.hooks?.[0]?.command).toBe(RELAY);
  });

  it("removes both when both are asked for, and that is two calls", async () => {
    // Deliberately two calls rather than one that takes both. "Remove everything"
    // and "remove the wait" are different things a user can mean, and one
    // function that does both would make the second silently become the first
    // whenever it was handed both commands -- which is exactly the call a single
    // `relay:uninstall` makes.
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);
    await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });

    await uninstallWait({ settingsPath, askCommand: ASK });
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    expect(commandsIn(current())).not.toContain(RELAY);
    expect(commandsIn(current())).not.toContain(ASK);
  });

  it("leaves a waiting hook alone when only the mascot is uninstalled", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);
    await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });

    // Uninstalling the mascot must not guess at the wait. Removing hooks by
    // guessing which program a line names would be editing somebody's
    // configuration on a guess, which is the one thing this module does not do.
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    expect(commandsIn(current())).toContain(ASK);
    expect(commandsIn(current())).not.toContain(RELAY);
  });

  it("leaves hooks it did not add alone, on the event it shares", async () => {
    const withForeign = JSON.stringify(
      {
        $schema: "https://json.schemastore.org/claude-code-settings.json",
        hooks: {
          PreToolUse: [
            { matcher: "Bash", hooks: [{ type: "command", command: "/home/me/mine.sh" }] },
          ],
        },
      },
      null,
      2
    );
    writeFileSync(join(workspace, ".claude", "settings.json"), withForeign);

    await installHooks({ settingsPath, relayCommand: RELAY, askCommand: ASK, confirmed: true });
    await uninstallWait({ settingsPath, askCommand: ASK });
    await uninstallHooks({ settingsPath, relayCommand: RELAY });

    // Somebody else's hook on the same event, in a group of their own, survives.
    expect(commandsIn(current())).toContain("/home/me/mine.sh");
  });
});

describe("installing twice", () => {
  it("leaves one copy of the waiting hook", async () => {
    writeFileSync(join(workspace, ".claude", "settings.json"), beforeInstall);
    await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });
    const once = current();

    const again = await installHooks({
      settingsPath,
      relayCommand: RELAY,
      askCommand: ASK,
      confirmed: true,
    });

    expect(again.applied).toBe(false);
    expect(current()).toBe(once);
    expect(commandsIn(current()).filter((command) => command === ASK)).toHaveLength(1);
  });

  it("reports the waiting hook as already there", () => {
    const plan = planHooks({ relayCommand: RELAY, askCommand: ASK, current: beforeInstall });
    const installed = plan.proposed;

    const second = planHooks({ relayCommand: RELAY, askCommand: ASK, current: installed });

    expect(second.unchangedBlocking).toEqual([...BLOCKING_HOOK_EVENTS]);
    expect(second.addedBlocking).toEqual([]);
  });
});
