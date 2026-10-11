/**
 * The companion process: listen on the channel, fold what arrives, say what
 * the reduction makes of it.
 *
 * This is the whole runtime the relay needs. It has no window and no platform
 * surface — that is `app-shell`, and until then it prints what it knows rather
 * than showing it, which is enough to see that a session started in a terminal
 * arrived on its own.
 *
 * It runs through `vite-node` rather than being bundled, because it imports the
 * same `src/state-selection` the tests do, and that is the point: what it prints
 * is the real reduction rather than a stand-in for it.
 *
 *   npm run companion
 */

import { openChannel } from "../src/relay/channel";
import { createClaudeCodeSource } from "../src/relay/session-source";
import { selectState } from "../src/state-selection/reduce";
import { escalates } from "../src/state-selection/escalation";

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

const source = createClaudeCodeSource();

/** The last state announced, so silence is not mistaken for a stalled companion. */
let announced: string | undefined;

const channel = await openChannel({
  onPayload: (payload) => {
    source.receive(payload);

    // One line per state change, not per payload. The host fires a hook on
    // every tool call, and a line per tool call would bury the one the user is
    // watching for.
    const state = selectState(source.sessions);
    if (state === announced) return;
    announced = state;

    const blocked = source.sessions.filter(escalates);
    out(
      `companion: ${state}` +
        (blocked.length > 0
          ? ` (blocked: ${blocked.map((session) => session.sessionId).join(", ")})`
          : "")
    );
  },
});

out(`companion: listening on ${channel.address}`);
out("companion: ready");

const stop = (): void => {
  void channel.close().catch(() => {});
  process.exit(0);
};

process.on("SIGINT", stop);
process.on("SIGTERM", stop);