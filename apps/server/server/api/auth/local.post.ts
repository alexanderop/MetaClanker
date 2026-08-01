import { createError, defineEventHandler, getRequestIP, setCookie } from "h3";

import { createEnvironmentSession, isLoopbackRequest } from "../../utils/auth.js";

export default defineEventHandler((event) => {
  const address = getRequestIP(event, { xForwardedFor: false });
  const forwardedAddress = getRequestIP(event, { xForwardedFor: true });
  if (!isLoopbackRequest(address, forwardedAddress, process.env["NITRO_DEV_WORKER_ID"])) {
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
