/**
 * Platform capability: can this platform keep a surface above other windows that
 * are not focused?
 *
 * ## Why the layer-shell protocol is the deciding factor
 *
 * A compositor owns the stacking order of its clients. "Keep this window on
 * top" is therefore not a request a client can make of a Wayland compositor the
 * way it can of a window manager: there is no honoured way to make it, and the
 * usual flags are accepted and discarded. What a client gets instead is whatever
 * it was placed into, and the only protocol that places a client into a layer of
 * its own — one that stays above ordinary windows while some other window holds
 * the keyboard — is `zwlr_layer_shell_v1`.
 *
 * Compositors differ on whether they implement it, and they differ for reasons
 * that have nothing to do with each other: one implements it, another never
 * will. So the capability is a property of *the compositor running right now*,
 * it is decided per platform rather than per build, and a build that asks this
 * question at runtime gets the right answer on all of them.
 *
 * ## What the probe actually measures
 *
 * One thing, and it is deliberately the narrowest question available: the list
 * of protocols the compositor granted this window's surface when it was bound.
 * A window that came up with a layer is a window that can stay on top; one that
 * came up without one cannot, whatever it asks for afterwards.
 *
 * It does not read an operating-system name, a desktop environment, a window
 * manager, or a build flag. None of those is the property, all of them are a
 * proxy for it, and every proxy is wrong somewhere — which is how "this works on
 * Linux" turns into a product that floats on two desktops and sinks on the
 * third. The protocol list is the fact itself rather than a rumour about it.
 *
 * The failure direction is chosen, not incidental. A host that cannot answer
 * reports no layer, which selects the escalate-only behaviour: a companion that
 * appears when it has something to say and is otherwise absent. That is correct
 * everywhere. The opposite mistake would report a layer that was never granted,
 * and produce a surface that believes it is floating while it is not.
 */

/** The protocol whose presence is what makes a persistent surface possible. */
export const LAYER_SHELL = "zwlr_layer_shell_v1";

/**
 * What the host reports about the window it opened.
 *
 * Written as a protocol list rather than a boolean on purpose: the boolean would
 * have to be trusted, and the list can be checked against the protocol that
 * actually decides the question.
 */
export interface HostWindow {
  /** Protocols the compositor granted this window's surface when it bound it. */
  readonly protocols: readonly string[];
}

/**
 * Where a native host publishes its report for this document to read.
 *
 * A document cannot bind a Wayland surface for itself, so the host that opened
 * the window is the only party that knows the answer, and it hands it over here.
 * Nothing writes to this key in this repository — it is the seam `agent-relay`
 * and the eventual shell will fill — so its absence is the ordinary case and is
 * handled as one rather than as a failure.
 */
export const HOST_WINDOW_KEY = "__SPARK_HOST_WINDOW__";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Read the host's protocol report out of a scope, or `null` if there is none.
 *
 * `null` is the answer from a plain browser document, and it is a real answer:
 * a document in a tab has no surface of its own to be granted a layer, so it
 * genuinely cannot hold one.
 */
export function readHostWindow(scope: unknown = globalThis): HostWindow | null {
  if (!isRecord(scope)) return null;

  const host = scope[HOST_WINDOW_KEY];
  if (!isRecord(host)) return null;

  const protocols = host["protocols"];
  if (!Array.isArray(protocols)) return null;

  return { protocols: protocols.filter((name): name is string => typeof name === "string") };
}

/**
 * Whether this platform can keep a persistent surface above other windows.
 *
 * One protocol lookup against what the compositor actually granted. `null`
 * answers `false`, so an unknown host gets the behaviour that works everywhere
 * rather than one that depends on the guess being right.
 */
export function canHoldPersistentSurface(host: HostWindow | null = readHostWindow()): boolean {
  return host !== null && host.protocols.includes(LAYER_SHELL);
}