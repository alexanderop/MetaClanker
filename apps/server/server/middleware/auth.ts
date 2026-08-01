import {
  createError,
  defineEventHandler,
  getCookie,
  getHeader,
  getRequestIP,
  getRequestURL,
} from "h3";

import { validateEnvironmentSession } from "../utils/auth.js";

const publicPaths = new Set(["/api/health", "/api/auth/local", "/api/auth/pair"]);

export default defineEventHandler((event) => {
  const url = getRequestURL(event);
  if (!url.pathname.startsWith("/api/") || publicPaths.has(url.pathname)) return;
  if (url.pathname.includes("/events") && url.searchParams.has("ticket")) return;
  const cookie = getCookie(event, "metaclanker_session");
  const authorization = getHeader(event, "authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (validateEnvironmentSession(cookie) || validateEnvironmentSession(bearer)) return;

  throw createError({
    statusCode: 401,
    statusMessage: "Authentication required",
    data: { remoteAddress: getRequestIP(event, { xForwardedFor: false }) },
  });
});
