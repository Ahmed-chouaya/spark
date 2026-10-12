import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { posixPath } from "./support/paths";

/**
 * Isolation guards for the escalation surface harness.
 *
 * The state harness is forbidden from deciding which state to show
 * (`dev-harness-isolation.test.ts`). This page is held to the opposite rule, and
 * for the same reason: its whole purpose is to drive the real surface, so if it
 * reimplemented any of that logic the two copies would drift and the page would
 * be testing something that no longer exists in the product.
 *
 * So: it must go through `src/escalation`, it must not compute a state or judge
 * a block itself, and nothing in `src/` may import it.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(REPO_ROOT, "src");
const DEV_DIR = join(SRC_DIR, "dev");
const ESCALATION_DIR = join(SRC_DIR, "escalation");

interface Source {
  name: string;
  path: string;
  code: string;
}

const sourcesIn = (dir: string, pattern: RegExp): Source[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => pattern.test(path))
    .map((path) => ({
      // Normalised: compared against slash-written literals below, and `relative`
      // answers with the host's separator.
      name: posixPath(relative(REPO_ROOT, join(dir, path))),
      path: join(dir, path),
      code: readFileSync(join(dir, path), "utf8"),
    }));

/** Strip comments, so prose about a rule cannot trip the rule's own check. */
const code = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

const specifiers = (source: string): string[] =>
  [...code(source).matchAll(/(?:^|\s)from\s+["']([^"']+)["']/gm)].map((match) => match[1] ?? "");

const within = (dir: string, target: string): boolean =>
  target === dir || target.startsWith(dir + sep);

/** The surface harness: its page and its entry, and nothing from the state page. */
const surfaceHarness = (): Source[] =>
  sourcesIn(DEV_DIR, /\.tsx?$/).filter(
    ({ name }) => name !== "src/dev/DevPage.tsx" && name !== "src/dev/main.tsx"
  );

/** Everything that ships: the harness excluded. */
const productSources = (): Source[] =>
  sourcesIn(SRC_DIR, /\.(ts|tsx)$/).filter(({ path }) => !within(DEV_DIR, path));

describe("the surface harness drives the product rather than reimplementing it", () => {
  it("reaches the surface through the escalation module", () => {
    const harness = surfaceHarness();
    expect(harness.length, "the surface harness exists").toBeGreaterThan(0);

    const reachesProduct = harness.flatMap((source) =>
      specifiers(source.code)
        .filter((specifier) => specifier.startsWith("."))
        .map((specifier) => resolve(dirname(source.path), specifier))
    );

    // Every product module it reaches is the escalation surface, its own stylesheet
    // or a sibling in the harness. A harness that also imported the mascot or state
    // selection directly would be rebuilding the wiring the module already owns.
    expect(reachesProduct.length).toBeGreaterThan(0);
    for (const target of reachesProduct) {
      expect(within(ESCALATION_DIR, target) || within(DEV_DIR, target), String(target)).toBe(true);
    }
  });

  it("takes the surface from the module rather than assembling its own", () => {
    const page = surfaceHarness().find(({ name }) => name.endsWith("SurfaceHarness.tsx"));
    expect(page, "the surface page exists").toBeTruthy();

    const body = code(page!.code);
    // The hook is what owns the question of which state to show; the page asks it
    // rather than answering it.
    expect(body).toMatch(/\buseCompanionSurface\b/);
    expect(body).toMatch(/\busePendingDecisions\b/);
  });

  it("decides no state and judges no block itself", () => {
    // The duplication this page exists to avoid. `selectState` and `escalates`
    // each have one home, and the page may not become a second one.
    const bodies = surfaceHarness().map(({ code: source }) => code(source)).join("\n");

    for (const symbol of ["selectState", "escalates", "classify", "applyEvent"]) {
      const defined = new RegExp(`(?:function|const)\\s+${symbol}\\b`);
      expect(defined.test(bodies), symbol).toBe(false);
    }
  });

  it("is imported by no product source, resolving each specifier to a path", () => {
    for (const source of productSources()) {
      for (const specifier of specifiers(source.code)) {
        if (!specifier.startsWith(".")) continue;
        const target = resolve(dirname(source.path), specifier);
        expect(within(DEV_DIR, target), `${source.name} imports ${specifier}`).toBe(false);
      }
    }
  });

  it("is reachable only through the page the run drives", () => {
    // Both pages are served by the same dev server, so the surface harness has
    // to be a page of its own rather than a mode of the state page — otherwise
    // the state page would have to import the surface module and give up the
    // isolation the state guard holds it to.
    const html = readFileSync(join(REPO_ROOT, "surface.html"), "utf8");
    expect(html).toContain("/src/dev/surface-main.tsx");

    const stateHtml = readFileSync(join(REPO_ROOT, "index.html"), "utf8");
    expect(stateHtml).toContain("/src/dev/main.tsx");
    expect(stateHtml).not.toContain("surface");
  });
});