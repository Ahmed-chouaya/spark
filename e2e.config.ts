import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { opencodeConsole } from 'e2e/oauth/opencode-console';

export default {
  // Your OpenCode Console workspace serves the model; sign in once with `e2e login opencode-console`, `e2e models opencode-console` lists the ids.
  agents: {
    default: {
      model: opencodeConsole('deepseek-v4.1-flash'),
      system: 'You are a thorough QA agent. Verify every outcome.',
    },
  },
  targets: [{
    engine: web(),
    app: {
      url: process.env.APP_URL ?? 'http://localhost:3000',
      // The mascot harness. `vite.config.ts` pins this to the same address
      // with `strictPort`, so a conflict stops the server rather than moving
      // it somewhere this URL does not point.
      command: {
        executable: 'npm',
        args: ['run', 'dev'],
        // Reuse a dev server the developer already has open.
        //
        // Without this the two are mutually exclusive: `command` wants to spawn
        // one, `strictPort` guarantees a second cannot bind, and a run against an
        // already-serving address fails `APP_ALREADY_RUNNING` rather than doing
        // anything useful. That is the normal state while developing, not an
        // edge case.
        //
        // Staleness is not a risk for this target: Vite serves from source, so
        // the running process is the current code. And the flag is self-limiting
        // for CI, which ignores it and always starts the command.
        reuseExisting: true,
      },
    },
  }],
} satisfies E2EConfig;
