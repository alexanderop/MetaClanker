import { createError, defineEventHandler, getHeader } from "h3";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { HealthResponse } from "@metaclanker/contracts/wire";

import { encodeResponse } from "../utils/http.js";

export default defineEventHandler(async (event) => {
  const configured = await Effect.runPromise(
    Config.option(Config.string("METACLANKER_READINESS_TOKEN")),
  );
  const expected = Option.getOrUndefined(configured);
  if (expected !== undefined && getHeader(event, "x-metaclanker-readiness") !== expected) {
    throw createError({ statusCode: 401, message: "Readiness token required" });
  }
  return encodeResponse(HealthResponse, {
    status: "ready",
    protocolVersion: 1,
    serverTime: new Date().toISOString(),
  });
});
