import { createError, defineEventHandler, getHeader, getRequestIP, setCookie } from "h3";

import { createEnvironmentSession, isTrustedLocalBootstrap } from "../../utils/auth.js";

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
    throw createError({ statusCode: 403, statusMessage: "Local bootstrap is loopback-only" });
  }
  const session = createEnvironmentSession();
  setCookie(event, "metaclanker_session", session, {
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return { authenticated: true };
});
