import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  getRequestProtocol,
  setCookie,
} from "h3";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { AuthenticationResponse } from "@metaclanker/contracts/wire";

import {
  createEnvironmentSession,
  isTrustedLocalBootstrap,
  sessionCookieOptions,
} from "../../utils/auth.js";
import { runApplication } from "../../utils/runtime.js";
import { encodeResponse } from "../../utils/http.js";

export default defineEventHandler(async (event) => {
  const workerId = Option.getOrUndefined(
    await Effect.runPromise(Config.option(Config.string("NITRO_DEV_WORKER_ID"))),
  );
  const address = getRequestIP(event, { xForwardedFor: false });
  const forwardedAddress = getRequestIP(event, { xForwardedFor: true });
  if (
    !isTrustedLocalBootstrap({
      address,
      forwardedAddress,
      nitroDevWorkerId: workerId,
      host: getHeader(event, "host"),
      origin: getHeader(event, "origin"),
    })
  ) {
    throw createError({ statusCode: 403, message: "Local bootstrap is loopback-only" });
  }
  const session = await runApplication(createEnvironmentSession);
  setCookie(
    event,
    "metaclanker_session",
    session,
    sessionCookieOptions(getRequestProtocol(event) === "https"),
  );
  return encodeResponse(AuthenticationResponse, { authenticated: true });
});
