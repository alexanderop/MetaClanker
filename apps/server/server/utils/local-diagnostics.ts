import { appendFile, mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { ProjectId, ThreadId, TurnId } from "@metaclanker/contracts/ids";
import type { Provider } from "@metaclanker/contracts/wire";

const maximumBytes = 1024 * 1024;
const maximumAgeMilliseconds = 7 * 24 * 60 * 60 * 1000;

export interface LocalDiagnosticRecord {
  readonly operation: string;
  readonly phase: "started" | "completed";
  readonly outcome?: "ok" | "failed" | "interrupted";
  readonly durationMs?: number;
  readonly queueLagMs?: number;
  readonly provider?: Provider;
  readonly projectId?: ProjectId;
  readonly threadId?: ThreadId;
  readonly turnId?: TurnId;
}

export interface LocalDiagnosticsService {
  readonly record: (record: LocalDiagnosticRecord) => Effect.Effect<void>;
  readonly flush: Effect.Effect<void>;
}

export class LocalDiagnostics extends Context.Service<LocalDiagnostics, LocalDiagnosticsService>()(
  "@metaclanker/server/LocalDiagnostics",
) {}

const discard = (): LocalDiagnosticsService => ({
  record: () => Effect.void,
  flush: Effect.void,
});

const prepareDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true });
  const now = Date.now();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith("trace")) continue;
    const path = join(directory, entry.name);
    const metadata = await stat(path);
    if (now - metadata.mtimeMs > maximumAgeMilliseconds) await unlink(path);
  }
};

const appendRecord = async (directory: string, record: LocalDiagnosticRecord): Promise<void> => {
  const current = join(directory, "trace.ndjson");
  const rotated = join(directory, "trace.1.ndjson");
  const line = `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString(), ...record })}\n`;
  const currentSize = await stat(current).then(
    (metadata) => metadata.size,
    () => 0,
  );
  if (currentSize + Buffer.byteLength(line) > maximumBytes) {
    await unlink(rotated).catch(() => undefined);
    await rename(current, rotated).catch(() => undefined);
  }
  await appendFile(current, line, { encoding: "utf8", mode: 0o600 });
};

export const localDiagnosticsLayer = (dataDirectory: string, enabledOverride?: boolean) =>
  Layer.effect(
    LocalDiagnostics,
    Effect.gen(function* () {
      const enabled =
        enabledOverride ??
        (yield* Config.string("METACLANKER_DIAGNOSTICS").pipe(Config.withDefault("0"))) === "1";
      if (!enabled) return discard();
      return yield* Effect.acquireRelease(
        Effect.tryPromise(() => prepareDirectory(join(dataDirectory, "diagnostics"))).pipe(
          Effect.map(() => {
            let pending = Promise.resolve();
            const diagnosticsDirectory = join(dataDirectory, "diagnostics");
            const service: LocalDiagnosticsService = {
              record: (record) =>
                Effect.promise(() => {
                  pending = pending
                    .then(() => appendRecord(diagnosticsDirectory, record))
                    .catch(() => undefined);
                  return pending;
                }),
              flush: Effect.promise(() => pending),
            };
            return service;
          }),
          Effect.catch(() => Effect.succeed(discard())),
        ),
        (service) => service.flush,
      );
    }),
  );
