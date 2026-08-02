import { defineNitroPlugin } from "nitropack/runtime/plugin";
import { useRuntimeConfig } from "nitropack/runtime/config";

import { closeAgentSessions } from "../utils/orchestrator.js";
import { closeApplicationRuntime, installApplicationRuntime } from "../utils/runtime-app.js";
import { makeApplicationRuntime } from "../utils/runtime.js";

interface NitroAppWithCloseHook {
  readonly hooks: {
    readonly hook: (name: "close", callback: () => Promise<void>) => void;
  };
}

interface ServerRuntimeConfig {
  readonly metaclanker: { readonly dataDirectory: string };
}

// Nitro's generated plugin declaration is unavailable before the first server build.
// eslint-disable-next-line @typescript-eslint/no-unsafe-call
export default defineNitroPlugin((nitroApp: NitroAppWithCloseHook) => {
  // Nitro v2's virtual runtime-config declaration only exists after the first server build.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const runtimeConfig: ServerRuntimeConfig = useRuntimeConfig() as ServerRuntimeConfig;
  const dataDirectory =
    process.env["METACLANKER_DATA_DIR"] ?? runtimeConfig.metaclanker.dataDirectory;
  installApplicationRuntime(nitroApp, makeApplicationRuntime(dataDirectory));
  nitroApp.hooks.hook("close", async () => {
    await closeAgentSessions();
    await closeApplicationRuntime(nitroApp);
  });
});
