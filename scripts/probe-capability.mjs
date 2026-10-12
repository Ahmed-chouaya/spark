#!/usr/bin/env node
/**
 * Run the capability probe against this machine and report what it found.
 *
 * The probe's answer is a fact about the platform, so the only honest way to
 * verify it on a given machine is to run it there. This prints the environment
 * it ran in next to the answer, because the two have to agree: a machine running
 * a compositor that does not implement `zwlr_layer_shell_v1` has to report that
 * it cannot hold a persistent surface.
 *
 * It also prints *which question was asked*, because that is the part worth
 * reading. "cannot hold a persistent surface" says nothing about how this was
 * determined, and a probe that reports a conclusion without its method is the
 * shape of thing that shipped reporting escalate-only on Windows 11 — where a
 * persistent surface works. `placement` is what makes the answer checkable.
 *
 *   node scripts/probe-capability.mjs
 *
 * Exits non-zero if the probe throws, so a broken probe is a failed run rather
 * than a printed line nobody reads.
 */
import { canHoldPersistentSurface, readHostWindow } from "../src/escalation/capability.ts";
// Imported from `placements` rather than re-read through `capability.ts` because
// node's ESM resolver wants the extension on a `.ts` import it will not resolve
// itself. It is the same binding either way — `capability.ts` only re-exports it
// — and a re-export of a re-export is the kind of indirection that reads as
// over-engineering right up until a tool without a bundler tries to follow it.
import { SURFACE_PLACEMENTS } from "../src/escalation/placements.ts";

const environment = {
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null,
  DISPLAY: process.env.DISPLAY ?? null,
  XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? null,
  XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP ?? null,
};

const host = readHostWindow();
const persistent = canHoldPersistentSurface(host);

// What each mechanism means, so the printed answer is readable without opening
// `capability.ts`. Duplicated as prose rather than derived from the module: a
// tool that prints the question asked is a tool about questions, and the one
// place this list can be wrong without anything breaking is a printed line.
const MECHANISM = {
  "wayland-layer": "did the compositor bind a layer surface to this window?",
  "windows-topmost": "is WS_EX_TOPMOST set on this window's real handle?",
  "macos-level": "is this window's level a floating level?",
  unknown: "there was no window to ask",
};

console.log(`host report     ${host ? JSON.stringify(host) : "(none — a document with no host behind it)"}`);
console.log(`environment     ${JSON.stringify(environment)}`);
console.log(`mechanisms      ${SURFACE_PLACEMENTS.join(", ")}`);
console.log(`asked           ${host ? MECHANISM[host.placement] : MECHANISM.unknown}`);
console.log(`can hold a persistent surface: ${persistent}`);
console.log(
  persistent
    ? "-> ambient behaviour: visible whenever nothing is blocked"
    : "-> escalate-only behaviour: absent unless something is blocked"
);

// Said explicitly rather than left to the reader: a "no" here is a fact about
// this machine's compositor, and on a platform where the question could not be
// asked it is a fact about the host instead. Both escalate; only one of them
// tells you where to look.
if (host && host.placement === "unknown") {
  console.log("note            no window answered, so this says the host could not ask — not that the platform said no");
}