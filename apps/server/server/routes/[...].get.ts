import { createError, defineEventHandler, setHeader } from "h3";
import { useStorage } from "nitropack/runtime/storage";

interface ShellAssetStorage {
  readonly getItemRaw: <A>(key: string) => Promise<A | null>;
}

export default defineEventHandler(async (event) => {
  // Nitro v2 ships this runtime helper without a resolvable declaration in the server build.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const shellStorage = useStorage("assets:shell") as ShellAssetStorage;
  const shell = await shellStorage.getItemRaw<string>("index.html");
  if (shell === null) {
    throw createError({ statusCode: 500, message: "Application shell is unavailable" });
  }
  setHeader(event, "content-type", "text/html; charset=utf-8");
  return shell;
});
