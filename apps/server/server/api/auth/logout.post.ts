import { defineEventHandler, deleteCookie, getCookie } from "h3";

import { AuthenticationResponse } from "@metaclanker/contracts/wire";

import { revokeEnvironmentSession } from "../../utils/auth.js";
import { runApplication } from "../../utils/runtime.js";
import { encodeResponse } from "../../utils/http.js";

export default defineEventHandler(async (event) => {
  const session = getCookie(event, "metaclanker_session");
  if (session !== undefined) await runApplication(revokeEnvironmentSession(session));
  deleteCookie(event, "metaclanker_session", { path: "/" });
  return encodeResponse(AuthenticationResponse, { authenticated: false });
});
