import { createError, defineEventHandler, getRequestIP } from "h3";

import { isLoopbackRequest, pairingHint } from "../../utils/auth.js";

export default defineEventHandler((event) => {
  const address = getRequestIP(event, { xForwardedFor: false });
  const forwardedAddress = getRequestIP(event, { xForwardedFor: true });
  if (!isLoopbackRequest(address, forwardedAddress, process.env["NITRO_DEV_WORKER_ID"])) {
    throw createError({ statusCode: 403, statusMessage: "Pairing code is loopback-only" });
  }
  return { code: pairingHint() };
});
