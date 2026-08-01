import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defineEventHandler, setHeader } from "h3";

export default defineEventHandler(async (event) => {
  setHeader(event, "content-type", "text/html; charset=utf-8");
  return readFile(resolve(process.cwd(), ".output/public/index.html"), "utf8");
});
