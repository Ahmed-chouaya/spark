import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { posixPath } from "./support/paths";

/**
 * Structural guards.
 *
 * The rules these check are rules about the shape of the code rather than about
 * its behaviour: a per-tool mapping table, an agent-specific branch inside the
 * reduction, or a rendering concern leaking in. Each one is a temptation that
 * looks reasonable in review and produces exactly the treadmill or the coupling
 * this module was written to avoid, so each is pinned here where adding one
 * fails a test rather than passing review.
 */

const MODULE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../src/state-selection"
);

/** Every source file in the module. */
const sources = (): { name: string; code: string }[] =>
  readdirSync(MODULE_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".ts"))
    .map((path) => ({
      // Normalised: `readdirSync` answers with the host's separator, and the
      // expectation below is written with forward slashes.
      name: posixPath(path),
      code: readFileSync(join(MODULE_DIR, path), "utf8"),
    }));

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

/** Every string literal in the source, ignoring module specifiers. */
const literals = (source: string): string[] =>
  [...code(source)
    // Drop import statements: their literals are paths, not vocabulary.
    .replace(/^import[^;]+;/gm, " ")
    .matchAll(/(["'`])([^"'`\\\r\n]*)\1/g)].map((match) => match[2] ?? "");

describe("tool classification is soft, with no per-tool mapping", () => {
  it("names no tool anywhere in the effort classifier", () => {
    const source = readFileSync(join(MODULE_DIR, "tool-effort.ts"), "utf8");
    const vocabulary = new Set(literals(source));

    // The whole module's string vocabulary. A per-tool table would have to add
    // a tool's name to this set, so the guard is the vocabulary itself rather
    // than a watchlist of tools somebody remembered to forbid.
    expect([...vocabulary].sort()).toEqual(
      ["light", "ordinary", "heavy", "listening", "working", "focused"].sort()
    );
  });

  it("keeps effort classification free of any tool identity", () => {
    const source = readFileSync(join(MODULE_DIR, "tool-effort.ts"), "utf8");

    for (const term of ["tool_name", "toolName", "Bash", "Read", "Edit", "Grep", "Glob"]) {
      expect(code(source), term).not.toContain(term);
    }
  });
});

describe("the reduction is agent-agnostic", () => {
  it("contains no agent-specific branch", () => {
    const reduction = readFileSync(join(MODULE_DIR, "reduce.ts"), "utf8");

    for (const term of [
      "claude",
      "Claude",
      "hook",
      "tool_name",
      "notification",
      "Notification",
      "permission",
      "session_id",
      "adapter",
    ]) {
      expect(code(reduction), term).not.toContain(term);
    }
  });

  it("consumes no agent-specific type", () => {
    const reduction = code(readFileSync(join(MODULE_DIR, "reduce.ts"), "utf8"));
    const imports = [...reduction.matchAll(/^import[^;]+;/gm)].map((m) => m[0]);

    for (const statement of imports) {
      expect(statement, statement).not.toMatch(/claude-code|adapters\//);
    }
  });
});

describe("this module holds no rendering, window or IPC concerns", () => {
  it("imports nothing from the mascot library beyond the state names", () => {
    for (const { name, code: source } of sources()) {
      const statements = [...code(source).matchAll(/^import[^;]+;/gm)].map((m) => m[0]);
      for (const statement of statements) {
        if (!statement.includes("../components/mascot")) continue;
        // `types` is the vocabulary module: the state names and their type. It
        // carries no React component, so importing it is not a rendering
        // dependency.
        expect(statement, name).toMatch(/from "\.\.\/components\/mascot\/types"/);
        expect(statement, name).not.toMatch(/index/);
      }
    }
  });

  it("reaches for no window, overlay, IPC or rendering API", () => {
    // Platform-shaped tokens, so `TRANSIENT_WINDOW_MS` is not mistaken for a
    // DOM window and prose about display windows is not mistaken for one either.
    const forbidden = [
      "document",
      "globalThis",
      "window.",
      "BrowserWindow",
      "ipcRenderer",
      "ipcMain",
      "electron",
      "socket",
      "overlay",
      "canvas",
      "React",
      "react",
      "fetch(",
      "setTimeout",
      "setInterval",
      "process.",
      "require(",
    ];

    for (const { name, code: source } of sources()) {
      for (const term of forbidden) {
        expect(code(source), `${name}: ${term}`).not.toContain(term);
      }
    }
  });

  it("reads no ambient clock, so the whole module is a function of its input", () => {
    // `Date.now` is defaulted inside an adapter factory rather than called at
    // module scope; the default only runs if a caller omits the clock, and no
    // code path in this module reaches it on its own.
    //
    // The list rather than a count, because a second adapter defaulting the clock
    // is the correct thing and a count would fail on it — which is how a guard
    // ends up pressuring somebody into a shortcut. Naming them means adding one
    // is a deliberate act.
    const callers = sources().filter(({ code: source }) =>
      code(source).includes("Date.now")
    );

    expect(callers.map((c) => c.name)).toEqual([
      "adapters/claude-code.ts",
      "adapters/opencode.ts",
    ]);
  });
});

describe("the module documents the rules it holds itself to", () => {
  it("documents the reduction and its precedence rule", () => {
    const reduction = readFileSync(join(MODULE_DIR, "reduce.ts"), "utf8");

    expect(reduction).toMatch(/\/\*\*[\s\S]*blocked session outranks/i);
    expect(reduction).toMatch(/background session that fails[\s\S]*will not be noticed/i);
  });

  it("documents the precedence rule as derived rather than listed", () => {
    const classification = readFileSync(join(MODULE_DIR, "classification.ts"), "utf8");

    expect(classification).toMatch(/block > fault > transient > sustained > idle/);
    expect(classification).toMatch(/derived/i);
  });

  it("states the soft-classification guarantee against false precision", () => {
    const effort = readFileSync(join(MODULE_DIR, "tool-effort.ts"), "utf8");

    // The guarantee has to be stated as a refusal to claim precision, not only
    // as a description of the buckets — otherwise the vagueness reads as an
    // oversight and somebody "fixes" it with a per-tool table.
    expect(effort).toMatch(/false precision/i);
    expect(effort).toMatch(/per-tool mapping/i);
    expect(effort).toMatch(/cannot be \*wrong\*|no opinion/i);
  });
});