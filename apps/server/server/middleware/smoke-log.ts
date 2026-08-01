import { defineEventHandler, getRequestURL } from "h3";

export default defineEventHandler((event) => {
  if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
    process.stdout.write(`METACLANKER_SMOKE request ${getRequestURL(event).pathname}\n`);
  }
});
