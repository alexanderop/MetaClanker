import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ProjectId } from "@metaclanker/contracts/ids";
import { UpdateProjectRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Project ID required" });
  const input = await decodeBody(event, UpdateProjectRequest);
  const result = await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      return yield* store.updateProject(ProjectId.make(rawId), input);
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  publishShellEvent({
    type: "project-upserted",
    sequence: result.eventSequence,
    project: result.record,
  });
  return result.record;
});
