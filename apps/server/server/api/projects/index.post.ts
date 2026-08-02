import { basename, resolve } from "node:path";

import { defineEventHandler } from "h3";

import { createProject } from "@metaclanker/application/projects";
import { ProjectId } from "@metaclanker/contracts/ids";
import { CreateProjectRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, CreateProjectRequest);
  const path = resolve(input.path);
  const result = await runApplication(
    createProject({
      id: ProjectId.make(crypto.randomUUID()),
      commandId: input.commandId,
      name: input.name ?? basename(path),
      path,
      createdAt: new Date().toISOString(),
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  if (result.eventSequence !== null) {
    await publishShellEvent({
      type: "project-upserted",
      sequence: result.eventSequence,
      project: result.record,
    });
  }
  return result.record;
});
