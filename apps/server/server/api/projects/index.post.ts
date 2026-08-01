import { basename, resolve } from "node:path";

import { Effect } from "effect";
import { defineEventHandler } from "h3";

import { Files, Store } from "@metaclanker/application/commands";
import { ProjectId } from "@metaclanker/contracts/ids";
import { CreateProjectRequest } from "@metaclanker/contracts/wire";

import { decodeBody, publicError } from "../../utils/http.js";
import { publishShellEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async (event) => {
  const input = await decodeBody(event, CreateProjectRequest);
  const result = await runApplication(
    Effect.gen(function* () {
      const files = yield* Files;
      const store = yield* Store;
      const normalizedPath = resolve(input.path);
      const status = yield* files.validateProject(normalizedPath);
      return yield* store.createProject({
        id: ProjectId.make(crypto.randomUUID()),
        commandId: input.commandId,
        name: input.name ?? basename(normalizedPath),
        path: normalizedPath,
        gitBranch: status.branch,
        gitStatus: status.status,
        createdAt: new Date().toISOString(),
      });
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  if (result.eventSequence !== null) {
    publishShellEvent({
      type: "project-upserted",
      sequence: result.eventSequence,
      project: result.record,
    });
  }
  return result.record;
});
