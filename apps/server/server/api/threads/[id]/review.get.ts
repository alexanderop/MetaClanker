import { defineEventHandler } from "h3";

import { ThreadId } from "@metaclanker/contracts/ids";
import { ReviewResponse } from "@metaclanker/contracts/wire";
import { reviewThread } from "@metaclanker/application/review";

import { decodeRouteParam, encodeResponse, publicError } from "../../../utils/http.js";
import { runApplication } from "../../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  return runApplication(reviewThread(id))
    .then((review) => encodeResponse(ReviewResponse, review))
    .catch((cause: unknown) => {
      throw publicError(cause);
    });
});
