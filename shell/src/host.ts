/**
 * The seam between the document and the window it is drawn on.
 *
 * A webview cannot open a local socket, cannot move itself, and cannot ask the
 * compositor what it was granted. All three are things the native host can do
 * and this document cannot, so all three arrive here as four calls and one
 * published report.
 *
 * ## Deliberately not a decision
 *
 * Nothing in this file decides anything. It cannot: a host that answered
 * "should the window be visible" would be a second implementation of
 * `surfaceVisibility`, and the shape of that problem — one rule, consulted on
 * every event — is precisely what makes it hard to get wrong once. So this is
 * four verbs and one report, and the document decides what to ask for.
 *
 * ## Two hosts, one document
 *
 * `tauriHost()` talks to the real window. `absentHost()` answers for a plain
 * document, which is what the harness and the end-to-end run load, and which is
 * also what a user gets if they open the shell's page in a browser. Every call
 * on it records what it was asked for and does nothing, so the *decisions* can
 * be observed where there is no window to observe them on.
 */

import type { HostWindow } from "../../src/escalation/capability";

/** A rectangle in physical pixels, as the platform reports one. */
export interface WorkArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in physical pixels. */
export interface Position {
  readonly x: number;
  readonly y: number;
}

/**
 * What the window can be asked to do.
 *
 * Four calls, each returning what actually happened rather than what was
 * requested. That is not pedantry: `set_position` returns `Ok` on GNOME Wayland
 * and does nothing, so a port that returned the request would make the one
 * check that exists report itself.
 */
export interface ShellHost {
  /**
   * The work area of the monitor the pointer is on.
   *
   * `null` when the platform will not say. That is a real answer, and the caller
   * places the window at the documented corner rather than refusing to start.
   */
  workArea(): Promise<WorkArea | null>;

  /**
   * Move the window to `x`, `y`, and report where it ended up.
   *
   * `null` when the window would not move or would not say. Never the request.
   */
  place(x: number, y: number): Promise<Position | null>;

  /** Show or hide the window. */
  setVisible(visible: boolean): Promise<void>;

  /** Bring the window forward, so a decision the user must act on is reachable. */
  focus(): Promise<void>;
}

/** What `absentHost` was asked to do, in the order it was asked. */
export interface HostCalls {
  readonly workArea: number;
  readonly placed: readonly Position[];
  readonly visible: readonly boolean[];
  readonly focused: number;
}

/** A host that answers for a plain document, recording what it was asked. */
export interface AbsentHost extends ShellHost {
  /** Everything the document asked the window to do, so far. */
  readonly calls: HostCalls;
}

/**
 * The host for a document with no native window behind it.
 *
 * Not a stub. It is what makes the shell's own decisions checkable in a place
 * that has a DOM and no compositor: the end-to-end run loads exactly this page,
 * and the window calls it recorded are the window calls the real host would have
 * received.
 */
export function absentHost(options: {
  readonly workArea?: WorkArea | null;
  readonly placedAt?: Position | null;
} = {}): AbsentHost {
  const workArea = options.workArea ?? null;
  const placedAt = options.placedAt ?? null;

  let workAreaCalls = 0;
  const placed: Position[] = [];
  const visible: boolean[] = [];
  let focused = 0;

  return {
    get calls() {
      return { workArea: workAreaCalls, placed: [...placed], visible: [...visible], focused };
    },
    async workArea() {
      workAreaCalls += 1;
      return workArea;
    },
    async place(x, y) {
      placed.push({ x, y });
      return placedAt;
    },
    async setVisible(next) {
      visible.push(next);
    },
    async focus() {
      focused += 1;
    },
  };
}

/** The shape of the global Tauri installs when the document is a real webview. */
interface TauriInternals {
  core: { invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T> };
  event: { listen: (event: string, handler: (event: { payload: unknown }) => void) => Promise<() => void> };
}

/** The Tauri API, or `null` when this document is not inside a shell window. */
export function tauri(): TauriInternals | null {
  const internals = (globalThis as Record<string, unknown>)["__TAURI_INTERNALS__"];
  const api = (internals as { invoke?: unknown } | undefined)?.invoke;

  if (typeof api !== "function") return null;

  // The one place in this file that reaches into the runtime's globals, and it
  // does so by asking whether they are there rather than by trusting that they
  // are: the same document, built by the same source, runs with and without a
  // window behind it.
  return {
    core: { invoke: (internals as TauriInternals).core.invoke },
    event: { listen: (internals as TauriInternals).event.listen },
  };
}

/** The host for a document inside a real shell window. */
export function tauriHost(): ShellHost | null {
  const api = tauri();
  if (!api) return null;

  return {
    workArea: () => api.core.invoke<WorkArea | null>("work_area"),
    place: (x, y) => api.core.invoke<Position | null>("place_window", { x, y }),
    setVisible: (visible) => api.core.invoke<void>("set_window_visible", { visible }),
    focus: () => api.core.invoke<void>("focus_window"),
  };
}

/** The event the native host emits one payload's bytes on. */
export const PAYLOAD_EVENT = "spark://payload";

/**
 * Subscribe to payloads, handing each one on as the bytes it arrived as.
 *
 * A listener that is given a `number[]` rather than a `Uint8Array` would be a
 * listener that had already re-encoded them, and a host payload is not
 * guaranteed to be text: the relay writes what the host agent wrote and exits.
 */
export function subscribeToPayloads(deliver: (payload: Uint8Array) => void): () => void {
  const api = tauri();
  if (!api) return () => {};

  let cancelled = false;
  let stop: (() => void) | undefined;

  const ready = api.event.listen(PAYLOAD_EVENT, (event) => {
    const bytes = asBytes(event.payload);
    if (bytes) deliver(bytes);
  });

  void ready.then((unlisten) => {
    // The subscription can land after the document has gone, in which case the
    // listener is dropped immediately: a delivery into a torn-down tree is the
    // one way this could throw on the way out.
    if (cancelled) unlisten();
    else stop = unlisten;
  });

  return () => {
    cancelled = true;
    stop?.();
  };
}

/** The payload as bytes, or `null` when it is not a sequence of byte values. */
function asBytes(payload: unknown): Uint8Array | null {
  if (payload instanceof Uint8Array) return payload;
  if (!Array.isArray(payload)) return null;

  const bytes = new Uint8Array(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    const byte = payload[index];
    // A value outside 0..255 would silently wrap in a `Uint8Array`, and a
    // wrapped byte is a payload that has been changed by being received.
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[index] = byte;
  }

  return bytes;
}

/** What the document was told, from whichever host published it. */
export function readPublishedReport(scope: unknown = globalThis): HostWindow | null {
  const host = (scope as Record<string, unknown> | null | undefined)?.["__SPARK_HOST_WINDOW__"];
  if (typeof host !== "object" || host === null) return null;

  const protocols = (host as Record<string, unknown>)["protocols"];
  if (!Array.isArray(protocols)) return null;

  return {
    protocols: protocols.filter((name): name is string => typeof name === "string"),
  };
}
