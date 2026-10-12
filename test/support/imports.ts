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
 * The DLLs a Windows binary may legitimately import.
 *
 * A Windows system DLL is not the same category as a shared object a package
 * manager installed: these ship with Windows itself, in the system directory, and
 * every dynamically linked program on the platform links several. What must not
 * appear is anything a build put there — a language runtime, a native addon, a
 * vendored library.
 *
 * `api-ms-win-*` are API sets: the indirection layer Windows uses so one DLL
 * name resolves per Windows version. They are system files.
 */
const WINDOWS_SYSTEM_DLLS = [
  // The CRT, which a Rust build links unless built statically.
  /^(ucrtbase|msvcrt|vcruntime\d*|ucrtbased)\.dll$/i,
  // The kernel and the API sets above it.
  /^(kernel32|ntdll|kernelbase)\.dll$/i,
  /^(api-ms-win-[a-z0-9-]+)\.dll$/i,
  // Subsystems the standard library reaches for.
  /^(advapi32|bcrypt|user32|shell32|ole32|oleaut32|shlwapi|ws2_32|iphlpapi|sechost|combaseapi|rpcrt4|gdi32)\.dll$/i,
];

export function isWindowsSystemDll(name: string): boolean {
  return WINDOWS_SYSTEM_DLLS.some((pattern) => pattern.test(name));
}