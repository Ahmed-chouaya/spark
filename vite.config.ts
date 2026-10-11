import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * The development harness's dev server.
 *
 * There is no build step here and no production bundle to point at. This config
 * exists to put the mascot's state vocabulary on a served address, which is what
 * `e2e.config.ts` already points at. Everything here is development-only.
 */
export default defineConfig({
  plugins: [react()],

  // Explicit rather than implied. `index.html` and the dev entry both live at
  // the project root, and stating it keeps the served document independent of
  // the working directory the server happens to be started from.
  root: fileURLToPath(new URL(".", import.meta.url)),

  server: {
    port: 3000,

    // A port conflict must stop the server rather than move it. The address is
    // part of this change's contract — `e2e.config.ts` reaches the harness at
    // exactly this port, and an extra `+1` would silently point the runner at
    // whatever else claimed 3000, or at nothing at all.
    strictPort: true,
  },
});