/**
 * Spark, for OpenCode.
 *
 * Forwards this host's own event stream to the companion, which is the process
 * that knows what those events mean. This file is a pipe: it reads the host's
 * events, wraps each one so the companion knows whose it is, and hands it over.
 * It decides nothing.
 *
 * ## What "decides nothing" means here, concretely
 *
 * No canonical event name appears below. No mascot state appears below. The
 * mapping from `session.tool.called` to whatever the companion renders is not in
 * this file — it is in `src/state-selection/adapters/opencode.ts`, which is the
 * only place that knows what any of these mean.
 *
 * That is not tidiness. A plugin that interpreted events would put the host's
 * vocabulary in a second place, and the copy nothing tests is the copy that
 * quietly stops matching the one that is tested. `test/opencode-plugin.test.ts`
 * reads this source and fails if any of those names appears.
 *
 * ## Install
 *
 * Copy to `~/.config/opencode/plugins/` for every project, or
 * `.opencode/plugins/` for one. Reload with `opencode service restart`.
 *
 * ## What is not here
 *
 * **Permission answers.** This host has a hook that can approve or refuse a tool
 * call (`ctx.permission.hook`, answering `allow`/`deny`/`ask`) and it is
 * deliberately not wired. It never fired in any run made while writing this
 * file, and an unmeasured path that can refuse a tool call is worse than no path
 * at all — a wrong answer is indistinguishable from a right one. Wiring it needs
 * a run in which the hook fires, and then the same fail-open rules `ask/`
 * already holds.
 */

import { spawn } from "node:child_process";

/**
 * Where the relay is.
 *
 * `SPARK_RELAY` when it is set — which is how an install that is not in a
 * checkout points at its own copy — and the one beside this companion otherwise.
 * Not guessed from a search path: a wrong path means every event goes nowhere,
 * silently, which is the exact failure the error handling below is built around.
 */
const RELAY = process.env.SPARK_RELAY ?? "/usr/local/bin/spark-relay";

/**
 * The agent this plugin speaks for.
 *
 * Written into every payload so a companion shared with other hosts knows whose
 * event it is holding. Read by the companion, never by this file — the adapter
 * registered for this name is what does the reading.
 */
const AGENT = "opencode";

/**
 * Hand one host event to the companion.
 *
 * Fire and forget, and deliberately so: the host must never wait on a mascot.
 * The companion is a decoration and a question-asker, and a hook that could delay
 * somebody's tool call because a window is slow would not be a companion — it
 * would be a dependency on the host's critical path, which is the one thing
 * `relay/` was built to make impossible.
 *
 * A spawn per event is the cost. It is one short-lived process that reads bytes,
 * writes them and exits, and the alternative — a plugin holding a socket open —
 * would make the host's availability depend on the companion's.
 */
function forward(event) {
  try {
    const child = spawn(RELAY, [], {
      stdio: ["pipe", "ignore", "ignore"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    // Both handlers are no-ops when the child was never there. A relay that is
    // missing means a mascot that does not appear, which is a far better failure
    // than an agent that has stopped — and it is why nothing here throws.
    child.on("error", () => {});
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ agent: AGENT, event }));
    child.unref();
  } catch {
    /* a companion that is not running is not an error */
  }
}

export default {
  id: "spark",

  setup(ctx) {
    const controller = new AbortController();

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          // Every event the host emits, unaltered. Which ones mean something is
          // the adapter's question, and a plugin that had an opinion about it
          // would be a second implementation of the host's vocabulary.
          if (!event?.type) continue;
          forward(event);
        }
      } catch {
        // The stream ended, or the host is shutting down. Either way there is
        // nothing left to do, and this must not keep the host alive for it.
      }
    })();

    return () => controller.abort();
  },
};
