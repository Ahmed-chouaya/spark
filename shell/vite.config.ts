import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * The shell's own build.
 *
 * Separate from the development server's config, and the reason is the shape of
 * the repository rather than the shape of the app: `vite.config.ts` at the root
 * serves two harnesses for `e2e.config.ts`, while this one produces the bundle
 * Tauri embeds into the window. One page served, one page shipped, and neither
 * config knows about the other's entry points.
 *
 * `root` is `shell/`, so the entry is `shell/index.html` and the modules it
 * reaches — `src/escalation`, `src/state-selection`, `src/relay` — are imported
 * from there by relative path rather than re-declared here. The shell consumes
 * the existing surface; it does not have a copy of it.
 */
export default defineConfig({
  plugins: [react()],

  root: fileURLToPath(new URL(".", import.meta.url)),

  // The directory `tauri.conf.json` names as `frontendDist`, relative to
  // `shell/src-tauri/`. Stated here as well so the two cannot drift without
  // `test/shell-window.test.ts` failing on one of them.
  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,
    // A mascot, a card, and a stylesheet. One file each, because the window is
    // created once and never reloaded, so a request-per-module waterfall buys
    // nothing.
    target: "es2022",
    minify: "esbuild",
  },

  server: {
    fs: {
      // The shell reaches outside its own root for the modules it consumes.
      // Stated rather than discovered: without it the dev server serves this
      // page and 404s every import, which reads as a broken build rather than
      // as a missing allowance.
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
  },
});
