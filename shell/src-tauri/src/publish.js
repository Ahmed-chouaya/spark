// The host's report, published into the document before any of the page's own
// JavaScript runs.
//
// This file is the whole of the publishing step, and it is one file for both
// sides of the seam: `src/capability.rs` embeds it with `include_str!` and
// substitutes the placeholder, and `test/shell-capability.test.ts` reads the
// same bytes and does the same substitution before running them. A second copy
// of this template would be a second claim about what the document reads, and
// the one that mattered would be the copy nothing tested.
//
// The placeholder is a comment rather than a bare token so the file is valid
// JavaScript as it stands: it runs, and assigns an empty protocol list, which
// is the same answer a platform that granted nothing gets.
//
// Deliberately not a function call, a promise, or anything the page has to wait
// for. The surface reads the report during its first render, and a report that
// arrives later is a report that arrives after the decision it decides.
(function () {
  globalThis.__SPARK_HOST_WINDOW__ = { protocols: /*__SPARK_PROTOCOLS__*/ };
})();
