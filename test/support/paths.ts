import { sep } from "node:path";

/**
 * Path handling for tests that assert on file names.
 *
 * `relative()` and `join()` answer with the host's separator: `src/dev/main.tsx` on
 * Linux, `src\dev\main.tsx` on Windows. Every structural guard in this suite compares a
 * computed path against a literal written with forward slashes, so on Windows those
 * comparisons were all false — 21 failures that said nothing about the code under
 * test.
 *
 * The rules being guarded are about *which file imports what*, and `src/dev/main.tsx`
 * and `src\dev\main.tsx` are the same file. Normalising to one spelling makes the
 * assertions mean the same thing everywhere, and keeps a failure readable rather
 * than turning it into a separator diff.
 *
 * Deliberately not applied to file *contents* or to module specifiers: those are
 * written with forward slashes by convention and by the module resolver, on every
 * platform.
 */
export function posixPath(value: string): string {
  return sep === "/" ? value : value.split(sep).join("/");
}

/**
 * The `name` every `Source` in the structural guards carries.
 *
 * `relative(REPO_ROOT, ...)` is the honest answer and is what these guards want to
 * see — it is relative to the repository root rather than invented from a glob — it
 * just has to be spelled the same way on every machine.
 */
export function sourceName(from: string, target: string): string {
  return posixPath(target.slice(from.length + (from.endsWith(sep) ? 0 : 1)));
}

/**
 * The relay's built binary, named the way this platform names it.
 *
 * Cargo appends `.exe` on Windows and nothing anywhere else, so a hardcoded name
 * silently found nothing there — and every test that inspects the binary's bytes
 * then failed for want of a file rather than for want of a property.
 */
export function relayBinaryName(base: string): string {
  return process.platform === "win32" ? `${base}.exe` : base;
}