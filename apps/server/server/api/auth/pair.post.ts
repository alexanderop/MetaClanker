import { createError, defineEventHandler, getRequestProtocol, setCookie } from "h3";

import { AuthenticationResponse, PairRequest } from "@metaclanker/contracts/wire";

import {
  createEnvironmentSession,
  sessionCookieOptions,
  verifyPairingCode,
} from "../../utils/auth.js";
import { decodeBody, encodeResponse } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, PairRequest);
  if (!(await runApplication(verifyPairingCode(input.code)))) {
    throw createError({ statusCode: 403, message: "Invalid or expired pairing code" });
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
