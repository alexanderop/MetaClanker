import { createError, defineEventHandler, getHeader, getRequestIP } from "h3";

import { isTrustedLocalBootstrap, pairingHint } from "../../utils/auth.js";

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
    throw createError({ statusCode: 403, message: "Pairing code is loopback-only" });
  }
  return { code: pairingHint() };
});
