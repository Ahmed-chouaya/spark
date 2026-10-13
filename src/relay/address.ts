/**
 * The companion's addresses: documented paths, derived from the owning user.
 *
 * ## The rule
 *
 * ```
 *   unix    <root>/spark-<uid>/companion.sock     <- relay, one way
 *           <root>/spark-<uid>/decisions.sock    <- decision, request and answer
 *   windows \\.\pipe\spark-<username>-companion
 *           \\.\pipe\spark-<username>-decisions
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
 * ## Why the decisions socket is a second address
 *
 * Two listeners, two protocols, one per socket. A relay writes a payload and
 * leaves; a decision requester writes a payload and waits for an answer that
 * arrives on the same connection. A single listener serving both would have to
 * decide, per connection, which of the two it is talking to — and it would have
 * to decide it by looking at the bytes, because nothing negotiates.
 *
 * Guessing from the bytes is the failure this project has already declined
 * once. The relay exists as a separate program precisely so that no code on the
 * host's critical path has to know what a payload means, and the shape of that
 * argument does not change when the code is TypeScript instead of Rust: a
 * listener that guesses is a listener that eventually guesses wrong about a
 * payload nobody wrote it for. Two sockets cost one more entry in a directory
 * that is already `0700`, and they cost nothing anywhere else.
 *
 * ## Why identity and not a negotiated value
 *
 * The address is never chosen by one party and told to the other. A negotiation
 * step is another thing that can fail at the worst moment — the moment a user
 * needs the mascot — and there is nothing to negotiate here: the companion is
 * always at *its own* address and every program that talks to it looks for it
 * there.
 *
 * This module, `relay/src/address.rs` and `ask/src/address.rs` are three
 * implementations of this one rule, in two languages, on purpose: the programs
 * have to run with no runtime and no installed package, and that is worth files
 * of duplication that a test can pin. They are kept honest by
 * `test/relay-address.test.ts` and `test/decision-address.test.ts`, which build
 * the binaries and compare the answers.
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

/** The socket file inside it, for the relay. One way, and it leaves. */
const unixSocketName = "companion.sock";

/** The socket file inside it, for a decision. In, and an answer back out. */
const unixDecisionSocketName = "decisions.sock";

/**
 * The companion's relay address for one user.
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
 * The companion's decision address for one user.
 *
 * The same rule and the same directory, the other socket. See the module note
 * for why a program that waits for an answer does not share an address with one
 * that does not.
 */
export function decisionAddress(identity: UserIdentity): string {
  if (identity.kind === "name") {
    return `\\\\.\\pipe\\spark-${identity.name}-decisions`;
  }

  return `${UNIX_CHANNEL_ROOT}/${unixDirectory(identity.uid)}/${unixDecisionSocketName}`;
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

/** This user's decision address, or `null` when the user cannot be identified. */
export function currentDecisionAddress(): string | null {
  const identity = currentIdentity();
  return identity ? decisionAddress(identity) : null;
}