/**
 * Entry for the shell's own document.
 *
 * The document Tauri loads into the companion window. It mounts one tree and
 * subscribes to the payloads the native host forwards, and there is nothing else
 * in it — no toolbar, no settings, no second surface, because the requirement is
 * one mascot on one window and every control added here is one the user did not
 * ask for.
 *
 * The harness at `./harness` mounts the same runtime with a different host, which
 * is how the decisions can be checked on a machine whose compositor cannot honour
 * them.
 */

import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useCompanionShell } from "./companion";
import { absentHost, subscribeToPayloads, tauriHost } from "./host";
import "./shell.css";

const mount = document.getElementById("root");
if (!mount) throw new Error("the shell's document is missing its #root mount point");

function Shell() {
  // The window behind this document, or an absent one.
  //
  // The fallback is not an error path. The same document is served to a browser
  // for the harness and the end-to-end run, and there is no window there — which
  // is a state the shell has to survive rather than a situation it cannot be in.
  const host = tauriHost() ?? absentHost();
  const { receive } = useCompanionShell({ host });

  useEffect(() => subscribeToPayloads(receive), [receive]);

  return null;
}

createRoot(mount).render(
  <StrictMode>
    <Shell />
  </StrictMode>
);
