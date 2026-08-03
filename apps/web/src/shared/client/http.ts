import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type { CheckpointId, CommandId, ThreadId } from "@metaclanker/contracts/ids";
import {
  PersistedCheckpointWire,
  RestorePreviewResponse,
  ReviewResponse,
} from "@metaclanker/contracts/wire";

import { ClientError } from "./errors.js";

type Decoder<A> = Schema.ConstraintDecoder<A, never>;

export interface RestoreFilesInput {
  readonly commandId: CommandId;
  readonly checkpointId: CheckpointId;
  readonly confirmed: true;
}

export interface ClientService {
  readonly identity: object;
  readonly review: (threadId: ThreadId) => Effect.Effect<typeof ReviewResponse.Type, ClientError>;
  readonly restorePreview: (
    threadId: ThreadId,
    checkpointId: CheckpointId,
  ) => Effect.Effect<typeof RestorePreviewResponse.Type, ClientError>;
  readonly restoreFiles: (
    threadId: ThreadId,
    input: RestoreFilesInput,
  ) => Effect.Effect<typeof PersistedCheckpointWire.Type, ClientError>;
}

export class Client extends Context.Service<Client, ClientService>()("@metaclanker/web/Client") {}

const request = <A>(
  operation: string,
  path: string,
  schema: Decoder<A>,
  fetcher: typeof globalThis.fetch,
  init?: RequestInit,
): Effect.Effect<A, ClientError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        fetcher(path, {
          credentials: "same-origin",
          ...init,
          signal,
          headers: { "content-type": "application/json", ...init?.headers },
        }),
      catch: () => new ClientError({ operation, kind: "network" }),
    });
    if (!response.ok) {
      return yield* Effect.fail(
        new ClientError({ operation, kind: "http", status: response.status }),
      );
    }
    const payload: unknown = yield* Effect.tryPromise({
      // Non-zero arity: an arity-0 callback silently opts out of cancellation, so an
      // interrupt could not stop a body read already in progress.
      try: async (signal): Promise<unknown> => {
        signal.throwIfAborted();
        return await response.json();
      },
      catch: () => new ClientError({ operation, kind: "invalid-json", status: response.status }),
    });
    return yield* Schema.decodeUnknownEffect(schema)(payload).pipe(
      Effect.mapError(
        () => new ClientError({ operation, kind: "invalid-response", status: response.status }),
      ),
    );
  });

export interface BrowserClientLayerOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly onCreate?: (service: ClientService) => void;
  readonly onFinalize?: (service: ClientService) => void;
}

export const browserClientLayer = (options: BrowserClientLayerOptions = {}): Layer.Layer<Client> =>
  Layer.effect(
    Client,
    Effect.acquireRelease(
      Effect.sync((): ClientService => {
        const fetcher = options.fetch ?? globalThis.fetch;
        const service: ClientService = {
          identity: {},
          review: (threadId) =>
            request(
              "load review",
              `/api/threads/${encodeURIComponent(threadId)}/review`,
              ReviewResponse,
              fetcher,
            ),
          restorePreview: (threadId, checkpointId) =>
            request(
              "load restore preview",
              `/api/threads/${encodeURIComponent(threadId)}/restore-preview`,
              RestorePreviewResponse,
              fetcher,
              { method: "POST", body: JSON.stringify({ checkpointId }) },
            ),
          restoreFiles: (threadId, input) =>
            request(
              "restore files",
              `/api/threads/${encodeURIComponent(threadId)}/restore`,
              PersistedCheckpointWire,
              fetcher,
              { method: "POST", body: JSON.stringify(input) },
            ),
        };
        options.onCreate?.(service);
        return service;
      }),
      (service) => Effect.sync(() => options.onFinalize?.(service)),
    ),
  );
