# Proposal

## Why

After `app-shell` and `decision-transport` the product works and cannot be started. The
shell is a Rust crate built by `cargo`; the relay is a Rust crate built by `cargo`; the
hooks point at absolute paths inside a checkout on one machine. There is no way for a
person to install this and have it run.

There is also nothing written down about how to try it. Every README in this repository
documents *why* something is the way it is, and none of them says: here is what to run, in
what order, and here is what you should see.

## What Changes

- The shell builds to a bundle per platform, with a real icon rather than the spike's
  placeholder.
- The two Rust programs ship next to the shell and the installer points at wherever they
  landed, rather than at a path inside a source checkout.
- One command builds everything, in dependency order, and fails loudly naming the thing
  that did not build.
- A top-level README that says what this is, how to install it, how to run it, how to try
  each piece, and how to uninstall it — including the host agent's own hooks.
- A single `npm run doctor` that reports what is installed, whether the hooks point at
  files that exist, and whether the companion is reachable.

**Not in this change:** code signing, notarisation, auto-update, or installers for
platforms nobody has tested. An unsigned build is honest about itself; a signed build on a
platform nobody has run is a claim.

## Capabilities

None. This change adds no behaviour the user can observe other than "it installs and
starts", which is the absence of a defect rather than a requirement. `skip_specs` is
declared for that reason and not as a shortcut.

## Impact

- `shell/tauri.conf.json` — bundle targets, icons.
- `scripts/build.ts` — the ordered build.
- `scripts/doctor.ts` — the install report.
- `README.md` — new at the repository root.
- Does not touch `src/`, `relay/` or `ask/`.
