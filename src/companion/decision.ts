/**
 * A decision, in the bytes the host reads.
 *
 * ## The format, and where it came from
 *
 * ```
 * {
 *   "hookSpecificOutput": {
 *     "hookEventName": "PreToolUse",
 *     "permissionDecision": "allow" | "deny",
 *     "permissionDecisionReason": "..."
 *   }
 * }
 * ```
 *
 * That is Claude Code's documented `PreToolUse` decision-control shape, taken
 * from the hooks reference (`docs/en/hooks`, "PreToolUse decision control"),
 * which is the same document the companion's `HOOK_EVENTS` list was read from.
 * It is stated here rather than derived, and the reference is named rather than
 * paraphrased, because a wrong guess here does not fail visibly: the host reads
 * output it does not understand as *no decision*, so a format invented from
 * memory is a feature that silently never works.
 *
 * Two details in that shape are load-bearing and are easy to leave out:
 *
 * - The decision lives **inside** `hookSpecificOutput`. `PreToolUse` used to
 *   read a top-level `decision` field, and that form is deprecated for this
 *   event; the deprecated `"approve"`/`"block"` values map onto `"allow"` and
 *   `"deny"`. Writing the old shape would work today and break later.
 * - `hookEventName` is **required** in that object. The reference says so
 *   directly. It is the one field in the reply that is the host's vocabulary
 *   rather than ours, and it is why this file exists at all.
 *
 * ## Why nothing else is in there
 *
 * `PreToolUse` also accepts `updatedInput`, `additionalContext` and `defer`, and
 * the top level accepts `continue`, `systemMessage` and `terminalSequence`.
 *
 * None of them appear, and the rule is not caution. A hook that can put text in
 * the model's context is a channel to the model, and a mascot that is not the
 * thing the user decided on is exactly how one gets built by accident. The
 * surface offers two answers and this file has two shapes; there is no third
 * thing to put in the envelope, and no code path by which one could appear.
 *
 * The reason is a fixed string rather than the operation. The host shows it to
 * the user on a refusal and to the model when it cannot ask — so it says who
 * refused and nothing about what was asked for, which keeps a decision about
 * one tool call from becoming an instruction about the next.
 *
 * ## The silence is not a bug, and the reference says so
 *
 * The other half of this contract is what happens when there is no decision to
 * report, and it is the half that would otherwise look like a defect. A timeout,
 * an absent companion or a broken channel all produce **no output at all**, and
 * that is correct rather than incomplete. The reference states it directly:
 *
 * > "Exit code 0 with no output means the hook has no decision to report, so the
 * > tool call continues through the normal permission flow. The hook can deny the
 * > call, but staying silent doesn't approve it."
 *
 * So silence is not approval and not refusal — it is the host doing exactly what
 * it would have done with no companion installed, which is the property the whole
 * fail-open design exists to preserve. A build that defaulted to `"deny"` on
 * timeout would be refusing a tool call the user never refused, and the user
 * could not tell that apart from a refusal they had chosen.
 *
 * ## Where this does not live
 *
 * Not in `src/relay/channel.ts`, which is transport and moves bytes without
 * knowing what they are, and not in `src/escalation`, which owns what the user
 * is offered and has no host vocabulary in it at all. This is the only file in
 * the repository that knows what a host's *answer* looks like, which is the
 * mirror of `src/state-selection/adapters` being the only one that knows what
 * its *input* looks like.
 */

import type { Decision } from "../escalation/pending";

/**
 * The host event these decisions are for.
 *
 * Named because the host's format requires it and nothing else here does. It is
 * the one piece of the host's vocabulary this file carries, and it is here
 * because the host reads it as part of the decision rather than as context
 * around it.
 */
const HOOK_EVENT_NAME = "PreToolUse";

/**
 * What the user is told when a request is refused.
 *
 * Fixed, and identical for every refusal. A reason that named the operation
 * would be more informative in a log and more dangerous in a prompt: the host
 * hands this to the model when it cannot ask a person, and a sentence that
 * describes one tool call is one step from being read as advice about the next.
 */
const REFUSAL = "Refused in the Spark companion.";

/**
 * The bytes a host reads for one decision.
 *
 * Total: two shapes, both of which are documented, neither of which carries
 * anything that is not a decision. `allow` carries no reason because the
 * reference says the reason for an allow is written to the debug log only — so
 * including one would be a string whose only purpose is to exist.
 */
export function permissionDecision(decision: Decision): Buffer {
  const hookSpecificOutput: Record<string, string> = {
    hookEventName: HOOK_EVENT_NAME,
    permissionDecision: decision,
  };
  if (decision === "deny") {
    hookSpecificOutput.permissionDecisionReason = REFUSAL;
  }

  return Buffer.from(`${JSON.stringify({ hookSpecificOutput })}\n`, "utf8");
}