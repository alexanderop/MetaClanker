import { createError } from "h3";

import { getThread } from "@metaclanker/application/workspace";
import { ThreadId } from "@metaclanker/contracts/ids";
import { ThreadDetail } from "@metaclanker/contracts/wire";

import { decodeRouteParam, defineApiHandler, encodeResponse } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const detail = await runApplication(getThread(id));
  if (detail === null) throw createError({ statusCode: 404, message: "Thread not found" });
  return encodeResponse(ThreadDetail, detail);
});
