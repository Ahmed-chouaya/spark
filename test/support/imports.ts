import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Reading the linked libraries out of a built binary.
 *
 * The relay is invoked as a bare command by another program, so anything it
 * resolves at start-up is something that can fail to resolve — and a relay that
 * fails to start does not look like a companion problem, it looks like the user's
 * agent breaking. Checking the linked libraries is how that is verified rather
 * than assumed.
 *
 * Each platform answers the question differently and neither answer is
 * translatable into the other: `ldd` reads an ELF's dynamic section, and a PE
 * carries its imports as an ASCII table inside the file.
 */

/** What `ldd` reports, or `null` where it cannot answer. */
export function linkedFromLdd(binary: string): string[] | null {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");

  const ldd = spawnSync("ldd", [binary], { encoding: "utf8" });
  // Absent, or a static build that genuinely links nothing.
  if (ldd.error || ldd.status !== 0) return null;

  return (ldd.stdout ?? "")
    .split("\n")
    // `linux-vdso.so.1` is a mapping the kernel synthesises, not a file on
    // disk, so it is nothing anybody has to install.
    .filter((line) => !line.includes("vdso"))
    .map((line) => line.trim().split(/\s+/)[0] ?? "")
    .filter((entry) => entry.includes(".so"))
    .map((entry) => entry.split("/").pop() ?? "")
    .sort();
}

/**
 * DLL names a PE binary imports.
 *
 * Read out of the bytes rather than by parsing the import table. The table is
 * ASCII, null-terminated, and the only `.dll` strings in a binary this small are
 * the imports — but the scan is over runs of printable characters rather than the
 * whole file, so a match has to be a name in its own right and cannot be a
 * fragment of some longer string.
 *
 * Kept separate from the assertion so it can be tested on any platform: a PE
 * parser that could only be exercised on Windows would be exactly the kind of
 * untested code this repository has been refusing to write.
 */
export function dllNames(binary: Uint8Array): string[] {
  // latin1 so every byte maps to one character and no multi-byte decoding can
  // merge two adjacent strings into one match.
  const text = Buffer.from(binary).toString("latin1");

  const found = new Set<string>();
  for (const run of text.split(/[^\x20-\x7e]+/)) {
    if (/\.dll$/i.test(run)) found.add(run);
  }
  return [...found].sort();
}

/**
 * An API set: a name Windows resolves to a real DLL per version, rather than to
 * a file.
 *
 * `api-ms-win-crt-runtime-l1-1-0.dll` has no file behind it — the loader maps it
 * through the API set schema, which is how Windows ships one runtime that works
 * across versions without the caller knowing which. Checking it against the
 * system directory would report a genuine system dependency as a foreign one, so
 * it is recognised by shape instead.
 */
export function isApiSet(name: string): boolean {
  return /^api-ms-win-[a-z0-9-]+\.dll$/i.test(name);
}

/**
 * The DLLs this Windows installation actually has.
 *
 * This is the property, not a list of them. An allowlist of acceptable names is
 * maintenance that Rust's standard library invalidates whenever it gains a
 * dependency — `dbghelp.dll` arrived that way, pulled in by the C runtime for
 * backtraces, and is a perfectly ordinary system library.
 *
 * What matters is not *which* system libraries the relay links but that every
 * one of them is one Windows already ships. A DLL in the system directory is on
 * every machine of this Windows version; anything else came from a build and
 * might not be there.
 */
export function installedSystemDlls(
  systemRoot: string | undefined = process.env.SystemRoot
): Set<string> {
  if (!systemRoot) return new Set();
  try {
    // Lower-cased for comparison: the import table and the directory do not
    // agree on case, and on Windows they are the same file either way.
    return new Set(
      readdirSync(join(systemRoot, "System32")).map((name) => name.toLowerCase())
    );
  } catch {
    return new Set();
  }
}

/**
 * Which imported libraries are not something Windows already had.
 *
 * Pure, so it is testable on any platform against a synthetic system directory —
 * which is the only way the Windows half stays verifiable from Linux at all.
 */
export function foreignImports(
  imported: readonly string[],
  systemDlls: ReadonlySet<string>
): string[] {
  return imported
    .filter((name) => !isApiSet(name))
    .filter((name) => !systemDlls.has(name.toLowerCase()))
    .sort();
}