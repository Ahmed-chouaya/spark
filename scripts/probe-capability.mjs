#!/usr/bin/env node
/**
 * Run the capability probe against this machine and report what it found.
 *
 * The probe's answer is a fact about the compositor, so the only honest way to
 * verify it on a given machine is to run it there. This prints the environment
 * it ran in next to the answer, because the two have to agree: a machine
 * running a compositor that does not implement `zwlr_layer_shell_v1` has to
 * report that it cannot hold a persistent surface.
 *
 *   node scripts/probe-capability.mjs
 *
 * Exits non-zero if the probe throws, so a broken probe is a failed run rather
 * than a printed line nobody reads.
 */
import { canHoldPersistentSurface, readHostWindow, LAYER_SHELL } from "../src/escalation/capability.ts";

const environment = {
  WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? null,
  DISPLAY: process.env.DISPLAY ?? null,
  XDG_SESSION_TYPE: process.env.XDG_SESSION_TYPE ?? null,
  XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP ?? null,
};

const host = readHostWindow();
const persistent = canHoldPersistentSurface(host);

console.log(`protocol        ${LAYER_SHELL}`);
console.log(`host report     ${host ? JSON.stringify(host.protocols) : "(none)"}`);
console.log(`environment     ${JSON.stringify(environment)}`);
console.log(`can hold a persistent surface: ${persistent}`);
console.log(
  persistent
    ? "-> ambient behaviour: visible whenever nothing is blocked"
    : "-> escalate-only behaviour: absent unless something is blocked"
);