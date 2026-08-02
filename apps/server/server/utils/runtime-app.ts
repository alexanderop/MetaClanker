import { useNitroApp } from "nitropack/runtime/app";

import type { ApplicationRuntime } from "./runtime.js";

const runtimes = new WeakMap<object, ApplicationRuntime>();

export const installApplicationRuntime = (
  nitroApp: object,
  runtime: ApplicationRuntime,
): ApplicationRuntime => {
  const existing = runtimes.get(nitroApp);
  if (existing !== undefined) return existing;
  runtimes.set(nitroApp, runtime);
  return runtime;
};

export const closeApplicationRuntime = async (nitroApp: object): Promise<void> => {
  const runtime = runtimes.get(nitroApp);
  if (runtime === undefined) return;
  runtimes.delete(nitroApp);
  await runtime.dispose();
};

export const currentApplicationRuntime = (): ApplicationRuntime => {
  // Nitro's v2 runtime declaration is generated during the server build.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const nitroApp = useNitroApp() as object;
  const runtime = runtimes.get(nitroApp);
  if (runtime === undefined) throw new Error("Application runtime has not been installed");
  return runtime;
};
