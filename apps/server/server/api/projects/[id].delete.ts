import { createError, defineEventHandler, getRouterParam } from "h3";

import { removeProject } from "@metaclanker/application/projects";
import { ProjectId } from "@metaclanker/contracts/ids";

import { publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const rawId = getRouterParam(event, "id");
  if (rawId === undefined) throw createError({ statusCode: 400, message: "Project ID required" });
  const result = await runApplication(removeProject(ProjectId.make(rawId))).catch(
    (cause: unknown) => {
      throw publicError(cause);
    },
  );
  await publishShellEvent({
    type: "project-removed",
    projectId: result.record,
    sequence: result.eventSequence,
  });
  return { removed: true };
});
