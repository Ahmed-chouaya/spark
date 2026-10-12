/**
 * The mechanisms this document is willing to hear a host say it asked about.
 *
 * ## Why the names describe mechanisms and not platforms
 *
 * Each of these is the answer to a different question, and the questions are
 * asked of different things: a compositor's protocol grants, the kernel's record
 * of a window's extended style, the window server's record of a window's level.
 * None of them is "which operating system is this", and naming them that way
 * would invite the reading that the capability is a property of an OS name —
 * which is precisely the proxy this module exists to stop using. A reader who
 * sees `windows-topmost` learns that the question was about a style bit, and can
 * go and check whether that bit means anything on their machine.
 *
 * `unknown` is in the list rather than beside it because it is an answer: it is
 * what a host publishes when there was no window to ask, and it has to be
 * readable rather than refused, or the escalate-only behaviour would have to be
 * reached by a different route and the two would drift apart.
 *
 * ## Why the names are constants rather than strings written where they are used
 *
 * Every spelling of a mechanism name has to agree across three places — the
 * surface's decision, the host that publishes, and the template that carries the
 * value — and a name spelled twice is two names waiting to drift apart, with the
 * drift showing up as a report that silently says no. So the vocabulary lives
 * here, once, and everything else refers to it.
 *
 * Kept in its own file so `capability.ts` reads as a decision rather than as a
 * list of strings. The Rust side names the same four; `test/shell-capability
 * .test.ts` compares the two, for the same reason `test/relay-address.test.ts`
 * compares two implementations of the address rule.
 */

/** How a platform was asked whether it can keep a surface above other windows. */
export type SurfacePlacement = "wayland-layer" | "windows-topmost" | "macos-level" | "unknown";

/** Did the compositor bind a layer surface to this window's surface? */
export const WAYLAND_LAYER = "wayland-layer";

/** Is the topmost extended style bit set on the real window handle? */
export const WINDOWS_TOPMOST = "windows-topmost";

/** Is the window's level a floating level? */
export const MACOS_LEVEL = "macos-level";

/** No platform was asked, because there was no window to ask. */
export const UNKNOWN_PLACEMENT = "unknown";

/** Every mechanism name a host may publish, and so every one this document accepts. */
export const SURFACE_PLACEMENTS: readonly SurfacePlacement[] = [
  WAYLAND_LAYER,
  WINDOWS_TOPMOST,
  MACOS_LEVEL,
  UNKNOWN_PLACEMENT,
];

/**
 * The report of a host that could ask nothing.
 *
 * Here rather than in `capability.ts` so that the decision module carries no
 * mechanism name at all — not even the negative case, which is the one that is
 * tempting to write inline precisely because it is the safe default.
 */
export const UNKNOWN_HOST_WINDOW = {
  placement: UNKNOWN_PLACEMENT,
  held: false,
} as const;