import { createError, defineEventHandler, getHeader } from "h3";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { HealthResponse } from "@metaclanker/contracts/wire";

import { encodeResponse } from "../utils/http.js";

export default defineEventHandler(async (event) => {
  // A credential: `Config.redacted` keeps it out of logs and `toString` even if this
  // value is ever caught in a cause or a diagnostic dump.
  const configured = await Effect.runPromise(
    Config.option(Config.redacted("METACLANKER_READINESS_TOKEN")),
  );
  const expected = Option.map(configured, Redacted.value);
  if (
    Option.isSome(expected) &&
    getHeader(event, "x-metaclanker-readiness") !== Option.getOrThrow(expected)
  ) {
    throw createError({ statusCode: 401, message: "Readiness token required" });
  }
  return encodeResponse(HealthResponse, {
    status: "ready",
    protocolVersion: 1,
    serverTime: new Date().toISOString(),
  });
});
