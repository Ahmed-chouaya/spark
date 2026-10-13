import { watchChannel } from "./src/relay/watch.ts";
import { buildAdapterRegistry, foldAgentPayload, parse, sessionChange } from "./shell/src/adapters";
const adapters = buildAdapterRegistry();
let seen: readonly any[] = [];
await watchChannel({
  address: process.env.SPARK_CHANNEL_ADDRESS!,
  attempts: 5,
  onPayload: (p) => {
    const f = foldAgentPayload(seen, adapters, parse(p.toString("utf8")));
    const c = sessionChange(seen, f.sessions);
    seen = f.sessions;
    if (c) console.log(c);
  },
});
console.log("WATCHER ATTACHED");
setTimeout(() => process.exit(0), 25000);
