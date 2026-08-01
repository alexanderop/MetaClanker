import { defineNitroPlugin } from "nitropack/runtime/plugin";

import { closeAgentSessions } from "../utils/orchestrator.js";
import { closeApplicationRuntime } from "../utils/runtime.js";

interface NitroAppWithCloseHook {
  readonly hooks: {
    readonly hook: (name: "close", callback: () => Promise<void>) => void;
  };
}

// Nitro's generated plugin declaration is unavailable before the first server build.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineNitroPlugin((nitroApp: NitroAppWithCloseHook) => {
  nitroApp.hooks.hook("close", async () => {
    await closeAgentSessions();
    await closeApplicationRuntime();
  });
});
