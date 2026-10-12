// The host's report, published into the document before any of the page's own
// JavaScript runs.
//
// This file is the whole of the publishing step, and it is one file for both
// sides of the seam: `src/capability.rs` embeds it with `include_str!` and
// substitutes the two tokens below, and `test/shell-capability.test.ts` reads
// the same bytes, does the same substitution, and runs the result. A second copy
// of this template would be a second claim about what the document reads, and
// the one that mattered would be the copy nothing tested.
//
// ## Why the tokens are bare identifiers rather than comments with defaults
//
// Both were tried and both were wrong in a way that only appears on a
// substituted run, which is the run nobody looks at.
//
// A comment placeholder with a fallback beside it — `placement: /*token*/
// "unknown"` — is not a placeholder with a fallback. Substituting leaves
// `"windows-topmost""unknown"`, which is valid JavaScript and the wrong value,
// because two adjacent string literals concatenate; and `held: /*token*/ false`
// leaves `truefalse`, which does not parse at all. The file looks safe and is
// not.
//
// Bare identifiers parse, which means the committed file is honest about its own
// state: you can read it, and running it unsubstituted throws a ReferenceError
// naming the token that was not replaced. A template that silently published a
// wrong report would be worse than one that refuses to publish anything.
//
// The tokens appear nowhere else in this file — including in the comment above,
// which is why that comment spells out the failure mode instead of quoting a
// token.
//
// ## What the report is for
//
// It names the mechanism that was asked alongside what it answered, so the value
// is auditable: a reader seeing a windows-topmost placement knows which question
// produced the boolean and can go check that question on their machine. A list
// of names would read as a list of protocols on a platform that has none, and
// the next reader would reasonably ask what protocol that is.
//
// Deliberately not a function call, a promise, or anything the page has to wait
// for. The surface reads the report during its first render, and a report that
// arrives later is a report that arrives after the decision it decides.
(function () {
  globalThis.__SPARK_HOST_WINDOW__ = {
    placement: __SPARK_PLACEMENT__,
    held: __SPARK_HELD__,
  };
})();