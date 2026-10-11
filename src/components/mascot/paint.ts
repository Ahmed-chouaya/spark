import { useId } from "react";

/**
 * A per-instance prefix for paint definition ids.
 *
 * React's `useId` emits values containing colons and guillemets
 * (`:r0:`, `«r0»`), which are legal in an id but awkward inside a
 * `url(#...)` reference and in a CSS selector. Stripping every
 * non-alphanumeric character keeps the id valid as both.
 */
export function usePaintId(): string {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}
