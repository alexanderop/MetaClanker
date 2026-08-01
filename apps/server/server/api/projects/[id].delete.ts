import { Effect } from "effect";
import { createError, defineEventHandler, getRouterParam } from "h3";

import { Store } from "@metaclanker/application/commands";
import { ProjectId } from "@metaclanker/contracts/ids";

import { publicError } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined)
    throw createError({ statusCode: 400, statusMessage: "Project ID required" });
  await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      yield* store.removeProject(ProjectId.make(rawId));
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  return { removed: true };
});
