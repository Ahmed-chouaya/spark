# Design

## The build order is a dependency graph, not a list

Three Rust programs with a real ordering between them:

```
  relay ──┐
          ├──> shell bundle (the installer must point at the other two)
  ask ────┘
```

The shell bundle is produced last because the installer it carries has to name paths to
the other two, and a bundle built first would embed paths to files that do not exist yet.
`npm run build` runs them in that order and names the thing that failed, because a build
script that prints a wall of cargo output and stops is a build script that has to be
re-run to find out why.

## Where the programs live at runtime

The installer must not point into a source checkout. A checkout is a developer's working
directory with a `.git` in it and a `node_modules` that may be half-installed; a user who
cloned the repository and deleted it should get a clear error, not a hook that silently
fails per event.

So the two programs are copied next to the built shell, and the installer's path is
resolved relative to the installed executable. The rule lives in one place —
`src/relay/binary.ts` already owns "where is the built binary" — and this change gives it
a second answer for "where is the installed one", rather than a third hardcoded path.

The Windows `.exe` suffix that `test/relay-imports.test.ts` and `test/relay-binary.test.ts`
already handle is the same problem in a different place, and going through the owner rather
than concatenating the extension is what keeps it from being solved twice and wrong once.

## `npm run doctor`

A person who has installed this and something is not working needs one command that says
what. It reports:

- whether the companion's hooks are installed, and whether the programs they name exist
- whether those programs are the ones this install put there
- whether the companion is reachable at the address it should be
- what the platform reports about a persistent surface

It **changes nothing**. A diagnostic that repairs things is a second thing, with its own
consent model, and the one thing worse than a companion that will not start is a doctor
that silently edits your agent's configuration while diagnosing it.

The last item is worth its own note: it runs the same probe the escalation surface runs, so
"the companion believes it cannot float" and "the platform says it cannot float" are one
answer reported twice rather than two answers that can disagree.

## The README

Written for someone who has never seen this project. It answers, in order: what is this,
what does it do, how do I install it, how do I run it, how do I know it is working, how do I
try each piece on its own, and how do I remove it.

The removal section is not an afterthought. This installs into the user's agent
configuration, and a tool that edits a config file and does not say how to undo it has made
a decision on the user's behalf. `npm run relay:uninstall` exists; the README says so in the
first screen, not in a footnote.

It also states plainly which platforms have been measured and which have not, in the same
table format the other READMEs use, because "works on my machine" is the sentence this
project has been arguing against since the first spike.

## Icons

The spike's `icon.png` is a placeholder. A shipped product needs a real mark, and it needs
one per platform because the formats differ and a wrong one produces a build failure rather
than an ugly icon — which is exactly what happened to the spike on Windows.

Generated from a source image by a committed script, for the reason `spikes/overlay/icons/make-icon.py`
already documents: a 32-bit BMP icon is not something to author by hand.

## What is deliberately absent

- **Code signing.** An unsigned macOS build will not open without a right-click. That is
  honest and fixable by the user; a self-signed certificate that expires is neither.
- **Auto-update.** It needs a server and a signing key. Out of scope for a v0.1 that has
  never been installed by anyone but its author.
- **Homebrew, winget, scoop, a `.deb`.** Every one of those implies a platform that has
  been tested on that platform's package tooling. Windows and Linux are; macOS is not.
