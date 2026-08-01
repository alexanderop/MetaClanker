import { Schema } from "effect";
import { createError, defineEventHandler, setCookie } from "h3";

import { createEnvironmentSession, verifyPairingCode } from "../../utils/auth.js";
import { decodeBody } from "../../utils/http.js";

const PairRequest = Schema.Struct({ code: Schema.NonEmptyString });

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, PairRequest);
  if (!verifyPairingCode(input.code)) {
    throw createError({ statusCode: 403, statusMessage: "Invalid or expired pairing code" });
  }
  const session = createEnvironmentSession();
  setCookie(event, "metaclanker_session", session, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return { authenticated: true };
});
