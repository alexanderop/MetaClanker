import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  getRequestProtocol,
  setCookie,
} from "h3";

import {
  createEnvironmentSession,
  isTrustedLocalBootstrap,
  sessionCookieOptions,
} from "../../utils/auth.js";

export default defineEventHandler((event) => {
  const address = getRequestIP(event, { xForwardedFor: false });
  const forwardedAddress = getRequestIP(event, { xForwardedFor: true });
  if (
    !isTrustedLocalBootstrap({
      address,
      forwardedAddress,
      nitroDevWorkerId: process.env["NITRO_DEV_WORKER_ID"],
      host: getHeader(event, "host"),
      origin: getHeader(event, "origin"),
    })
  ) {
    throw createError({ statusCode: 403, message: "Local bootstrap is loopback-only" });
  }
  const session = createEnvironmentSession();
  setCookie(
    event,
    "metaclanker_session",
    session,
    sessionCookieOptions(getRequestProtocol(event) === "https"),
  );
  return { authenticated: true };
});
