import { defineEventHandler, getRequestURL } from "h3";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

export default defineEventHandler(async (event) => {
  const enabled = await Effect.runPromise(
    Config.string("METACLANKER_PACKAGE_SMOKE").pipe(Config.withDefault("0")),
  );
  if (enabled === "1") {
    process.stdout.write(`METACLANKER_SMOKE request ${getRequestURL(event).pathname}\n`);
  }
});
