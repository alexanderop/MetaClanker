import { defineEventHandler } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { previewFileRestore } from "@metaclanker/application/review";
import { RestorePreviewRequest, RestorePreviewResponse } from "@metaclanker/contracts/wire";

import { decodeBody, decodeRouteParam, encodeResponse, publicError } from "../../../utils/http.js";
import { runApplication } from "../../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const input = await decodeBody(event, RestorePreviewRequest);
  return runApplication(previewFileRestore(id, input.checkpointId))
    .then((preview) => encodeResponse(RestorePreviewResponse, preview))
    .catch((cause: unknown) => {
      throw publicError(cause);
    });
});
