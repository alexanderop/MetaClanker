import { Schema } from "effect";
import { createError, defineEventHandler, getRequestProtocol, setCookie } from "h3";

import {
  createEnvironmentSession,
  sessionCookieOptions,
  verifyPairingCode,
} from "../../utils/auth.js";
import { decodeBody } from "../../utils/http.js";

const PairRequest = Schema.Struct({ code: Schema.NonEmptyString });

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, PairRequest);
  if (!verifyPairingCode(input.code)) {
    throw createError({ statusCode: 403, message: "Invalid or expired pairing code" });
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
