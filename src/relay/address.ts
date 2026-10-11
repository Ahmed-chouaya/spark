/**
 * The companion's address: one documented path, derived from the owning user.
 *
 * ## The rule
 *
 * ```
 *   unix    <root>/spark-<uid>/companion.sock
 *   windows \\.\pipe\spark-<username>-companion
 * ```
 *
 * `ROOT` is `/tmp` and is fixed rather than read from the environment, for a
 * reason that is about the relay and not about tidiness: **the relay is spawned
 * by the host agent, in an environment we do not control.** `XDG_RUNTIME_DIR` is
 * set by a session manager and inherited by whatever the agent happens to
 * invoke; it is absent under some launchers and set to different values under
 * others. A derivation that reads it is a derivation whose two halves can
 * disagree, and the failure mode of that disagreement is a companion that is
 * never reached — silently, forever, because the relay cannot report it (see
 * ./README for why it cannot).
 *
 * The parent directory is created `0700` by the companion, so the identity in
 * the path is not the only thing keeping users apart; it is the first of two.
 *
 * ## Why identity and not a negotiated value
 *
 * The address is never chosen by one party and told to the other. A negotiation
 * step is another thing that can fail at the worst moment — the moment a user
 * needs the mascot — and there is nothing to negotiate here: the companion is
 * always at *its own* address and the relay always looks for it there.
 *
 * This module and `relay/src/address.rs` are two implementations of this one
 * rule, in two languages, on purpose: the relay has to be a program with no
 * runtime, and that is worth one file of duplication that a test can pin. They
 * are kept honest by `test/relay-address.test.ts`, which builds the relay and
 * compares the two answers.
 *
 * ## What this is not
 *
 * Not a security boundary on its own. It is the *name* of the channel; the
 * boundary is the `0700` directory and `0600` socket the companion creates
 * around it, plus refusing to take over an entry belonging to another user.
 */

/**
 * Which account a channel belongs to.
 *
 * Deliberately not a single "username" string: POSIX has a numeric uid, which
 * is stable across a rename, and Windows has no uid at all, where the account
 * name is the only identity the address can carry. Modelling them as separate
 * variants is what stops the two platforms from quietly sharing a rule that
 * only one of them has.
 */
export type UserIdentity =
  | { readonly kind: "uid"; readonly uid: number }
  | { readonly kind: "name"; readonly name: string };

/** The fixed parent of every Unix companion socket. See the module note. */
export const UNIX_CHANNEL_ROOT = "/tmp";

/** The directory name a uid gets. One per user, whatever the username is. */
const unixDirectory = (uid: number): string => `spark-${uid}`;

/** The socket file inside it. */
const unixSocketName = "companion.sock";

/**
 * The companion's address for one user.
 *
 * Pure: it reads nothing, so a test can ask what two users would get without
 * being one of them.
 */
export function companionAddress(identity: UserIdentity): string {
  if (identity.kind === "name") {
    // Windows named pipes live in a flat namespace under `\\.\pipe`, and the
    // account name is what keeps two users' companions apart. Pipes are not
    // filesystem entries, so there is no directory to lock down here — the
    // pipe's own security descriptor is what refuses another user.
    return `\\\\.\\pipe\\spark-${identity.name}-companion`;
  }

  return `${UNIX_CHANNEL_ROOT}/${unixDirectory(identity.uid)}/${unixSocketName}`;
}

/**
 * The identity of the user running this process.
 *
 * The same two branches as `UserIdentity`, read the way each platform answers:
 * the numeric id where one exists, the account name where one does not.
 *
 * If neither can be read the caller gets `null` rather than a guess. An address
 * derived from a guessed identity is an address that reaches a *different
 * user's* companion or nobody's, and neither is recoverable by trying again.
 */
export function currentIdentity(): UserIdentity | null {
  if (process.platform === "win32") {
    const name = process.env.USERNAME ?? process.env.USER;
    return name ? { kind: "name", name } : null;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return uid === null ? null : { kind: "uid", uid };
}

/** This user's companion address, or `null` when the user cannot be identified. */
export function currentCompanionAddress(): string | null {
  const identity = currentIdentity();
  return identity ? companionAddress(identity) : null;
}