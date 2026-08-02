import { createError, defineEventHandler, getHeader } from "h3";

export default defineEventHandler((event) => {
  const expected = process.env["METACLANKER_READINESS_TOKEN"];
  if (expected !== undefined && getHeader(event, "x-metaclanker-readiness") !== expected) {
    throw createError({ statusCode: 401, message: "Readiness token required" });
  }
  return {
    status: "ready",
    protocolVersion: 1,
    serverTime: new Date().toISOString(),
  };
});
