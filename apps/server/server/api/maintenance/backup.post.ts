import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import { defineEventHandler } from "h3";

import { Store } from "@metaclanker/application/commands";
import { BackupResponse } from "@metaclanker/contracts/wire";

import { encodeResponse, publicError } from "../../utils/http.js";
import { applicationDataDirectory, runApplication } from "../../utils/runtime.js";

export default defineEventHandler(async () => {
  const backupDirectory = join(await applicationDataDirectory(), "backups");
  await mkdir(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const fileName = `metaclanker-${timestamp}.sqlite`;
  const destination = join(backupDirectory, fileName);
  await runApplication(
    Effect.gen(function* () {
      const store = yield* Store;
      yield* store.backup(destination);
    }),
  ).catch((cause: unknown) => {
    throw publicError(cause);
  });
  return encodeResponse(BackupResponse, { fileName });
});
