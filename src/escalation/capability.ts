/**
 * Platform capability: can this platform keep a surface above other windows that
 * are not focused?
 *
 * ## Why each platform is asked about itself
 *
 * The previous version of this module asked one question and sent it to every
 * platform: *did the compositor grant `zwlr_layer_shell_v1` to this window's
 * surface?* That is the right question for a Wayland compositor, where the
 * compositor owns the stacking order and the layer protocol is the only way into
 * a stack of its own. It is not a question Windows or macOS can answer at all:
 * neither has a compositor, neither has protocols, and neither will ever grant a
 * Wayland protocol to anything.
 *
 * So the answer came back empty everywhere, and the empty answer was read as
 * "no platform can float a persistent surface" when what had actually been
 * measured was "no host asked a question these platforms understand". The empty
 * list was true. The inference from it was the bug, and a category error is not
 * fixed by working harder on the inference.
 *
 * Each platform is now asked something it can answer about itself, and the
 * answer is published next to the name of the question, so a reader can see
 * which one produced it and go check that one. `placement` is not decoration: a
 * report of `{ placement: "windows-topmost", held: true }` can be audited,
 * whereas a list containing the string `"windows-topmost"` among protocol names
 * would be a lie about the kind of thing that is in it.
 *
 * ## Why a value the host wrote is not an answer
 *
 * The runtime offers `is_always_on_top()`, and reading it is the shape of
 * verification this project keeps asking for. It is not verification. On two of
 * its three desktop platforms it returns an atomic boolean or a flag the host
 * itself set a moment earlier, and on GNOME — the one machine where the
 * behaviour has been observed — the flag is accepted and then ignored, which is
 * already recorded in `docs/platform-findings.md`.
 *
 * A write-echo is worse than no answer, because it looks like evidence: a method
 * named `is_*` returning `true` after a `set_*(true)` is exactly what a reviewer
 * is looking for and cannot tell from the outside. So the published value may
 * only ever be something the platform itself states — a style bit the kernel
 * holds about a real window, a window level the window server holds, a protocol
 * the compositor bound to a surface. `test/shell-capability.test.ts` fails the
 * build if the Rust side reaches for the write-echo at all.
 *
 * It does not read an operating-system name, a desktop environment, a window
 * manager, or a build flag either. Each of those is a proxy for the property,
 * and every proxy is wrong somewhere — which is how "this works on Linux" turns
 * into a product that floats on two desktops and sinks on the third.
 *
 * ## The failure direction, which is the most important property here
 *
 * ```
 *   the platform answers "yes"      -> persistent
 *   the platform answers "no"       -> escalate-only
 *   there is no platform to ask     -> escalate-only
 * ```
 *
 * Both non-answers select escalate-only. That is unchanged from before and it is
 * deliberate rather than incidental: a companion that appears when it has
 * something to say and is otherwise absent is correct on every platform,
 * including the ones nobody has run it on. The opposite mistake — reporting a
 * capability that was never granted — produces a surface that believes it is
 * floating while it is not, which fails visibly and constantly rather than
 * quietly costing a feature.
 *
 * So a report that names no platform at all is not an error and not a missing
 * value. It is an answer: `placement: "unknown"`, `held: false`, and the
 * escalate-only behaviour. It is also kept *distinguishable* from a platform
 * that was asked and said no, because a report reading `{ placement:
 * "windows-topmost", held: false }` is a fact about Windows and a report
 * reading `{ placement: "unknown", held: false }` is a fact about the host — and
 * a reader debugging a machine needs to be able to tell which they are looking
 * at.
 */

import {
  SURFACE_PLACEMENTS,
  UNKNOWN_HOST_WINDOW,
  UNKNOWN_PLACEMENT,
  type SurfacePlacement,
  // The extension is written out because `scripts/probe-capability.mjs` runs this
  // module under bare `node`, whose ESM resolver will not add one. Every other
  // import in `src/` omits it, so this looks inconsistent and is not: it is the
  // price of a tool that has no bundler.
} from "./placements.ts";

export { SURFACE_PLACEMENTS, UNKNOWN_HOST_WINDOW, UNKNOWN_PLACEMENT };
export type { SurfacePlacement };

/**
 * What the host reports about the window it opened.
 *
 * Modelled as a mechanism plus an answer rather than as a boolean because the
 * boolean would have to be trusted: nothing here can check *why* a host said
 * yes, only which question it says it asked. Naming the question is the part
 * that survives review.
 */
export interface HostWindow {
  /** How this platform was asked, so the answer can be audited. */
  readonly placement: SurfacePlacement;
  /** What the platform answered. Never anything the host requested. */
  readonly held: boolean;
}

/**
 * Where a native host publishes its report for this document to read.
 *
 * A document cannot inspect a window handle, a window level or a compositor's
 * protocol grants for itself, so the host that opened the window is the only
 * party that can answer, and it hands the answer over here. Its absence is the
 * ordinary case — a document in a browser tab — and is handled as an answer
 * rather than as a failure, because a tab genuinely has no surface of its own.
 */
export const HOST_WINDOW_KEY = "__SPARK_HOST_WINDOW__";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Read the host's report out of a scope, or `null` if there is none.
 *
 * `null` means "there is no host here", which is the browser case and a real
 * answer. A report that *is* present but unreadable — a host handing back
 * nonsense, or a mechanism name this build has never heard of — is refused
 * rather than guessed at, because the consequence of an unreadable report is
 * the behaviour that works everywhere, which is what a refusal means.
 */
export function readHostWindow(scope: unknown = globalThis): HostWindow | null {
  if (!isRecord(scope)) return null;

  const host = scope[HOST_WINDOW_KEY];
  if (!isRecord(host)) return null;

  const placement = host["placement"];
  const held = host["held"];

  if (typeof placement !== "string" || !SURFACE_PLACEMENTS.includes(placement as SurfacePlacement)) {
    return null;
  }
  if (typeof held !== "boolean") return null;

  return { placement: placement as SurfacePlacement, held };
}

/**
 * Whether this platform can keep a persistent surface above other windows.
 *
 * `null` answers `false`, so a document with no host behind it gets the
 * behaviour that works everywhere rather than one that depends on a guess being
 * right.
 *
 * A report that names no mechanism also answers `false`, whatever it claims to
 * hold. That is the failure direction applied one step further: a host that
 * could not ask anything has not been told yes by anybody, so an affirmative
 * sitting beside `placement: "unknown"` is the host asserting rather than the
 * platform answering, and this is the one place a reported boolean is not taken
 * at its word.
 */
export function canHoldPersistentSurface(host: HostWindow | null = readHostWindow()): boolean {
  if (host === null) return false;
  if (host.placement === UNKNOWN_PLACEMENT) return false;
  return host.held;
}