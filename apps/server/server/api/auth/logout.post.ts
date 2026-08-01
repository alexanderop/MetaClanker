import { defineEventHandler, deleteCookie, getCookie } from "h3";

import { revokeEnvironmentSession } from "../../utils/auth.js";

export default defineEventHandler((event) => {
  const session = getCookie(event, "metaclanker_session");
  if (session !== undefined) revokeEnvironmentSession(session);
  deleteCookie(event, "metaclanker_session", { path: "/" });
  return { authenticated: false };
});
