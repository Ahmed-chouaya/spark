import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

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
/**
 * Emit the bundle as a classic script rather than an ES module.
 *
 * Vite always writes `<script type="module">`, whatever `output.format` says —
 * the format controls the JavaScript, the tag decides how the WebKit engine
 * loads it, and `type="module"` is what puts the page under CORS rules it cannot
 * satisfy over `tauri://`.
 *
 * `defer` rather than nothing, so the script still runs after the document is
 * parsed, which is what keeps the boot sequence the same as the one the
 * development server produces.
 */
function classicScriptTag(): Plugin {
  return {
    name: "spark-classic-script",
    enforce: "post",
    transformIndexHtml(html) {
      return html.replace(
        /<script type="module"([^>]*)src="([^"]+)"([^>]*)><\/script>/g,
        '<script defer src="$2"></script>'
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), classicScriptTag()],

  root: fileURLToPath(new URL(".", import.meta.url)),

  // The directory `tauri.conf.json` names as `frontendDist`, relative to
  // `shell/src-tauri/`. Stated here as well so the two cannot drift without
  // `test/shell-window.test.ts` failing on one of them.
  // Relative asset paths.
  //
  // The default is `/assets/...`, an absolute path from the root of whatever
  // origin is serving the page. The native host does not serve this from a root:
  // it serves `frontendDist` under the `tauri://` protocol at the document's own
  // path, so an absolute asset URL resolves against a directory that does not
  // exist. The page loads, the stylesheet and the script 404, and the window sits
  // there empty with the channel bound and no JavaScript having run.
  //
  // Found by running the built window on a real session: the page load events
  // fire Started and Finished, and the document's own title never changes.
  base: "./",

  build: {
    outDir: fileURLToPath(new URL("./dist", import.meta.url)),
    emptyOutDir: true,

    // One classic script, not an ES module.
    //
    // WebKit applies CORS to module scripts, and the `tauri://` custom protocol
    // answers no CORS headers — so `type="module"` loads a document whose script
    // silently never runs. The page renders its HTML and no JavaScript at all,
    // which on this companion means a window that binds the channel, receives
    // payloads, and shows nothing.
    //
    // An IIFE has no module semantics, so there is nothing to authorise. It also
    // suits the window: it is created once and never reloaded, so a single file
    // with no import graph is the whole of what a second round trip would buy.
    rollupOptions: {
      output: { format: "iife", inlineDynamicImports: true },
    },
    // A mascot, a card, and a stylesheet. One file each, because the window is
    // created once and never reloaded, so a request-per-module waterfall buys
    // nothing and a code-split bundle would only add a round trip to the first
    // render — which is the render that has to find the host's report.
    target: "es2022",
    minify: "esbuild",
    // React and the nine mascot states are the whole of it. The default 500 kB
    // warning fires on a bundle this small by design, and a warning on every
    // `npm run companion` trains the reader to skip the build output.
    chunkSizeWarningLimit: 600,
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
