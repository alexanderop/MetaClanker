import { AsyncResult, Atom, useAtomSet, useAtomValue } from "@effect/atom-vue";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { computed, inject, onUnmounted, ref, type InjectionKey } from "vue";

import { CommandId, type CheckpointId, type ThreadId } from "@metaclanker/contracts/ids";
import type {
  PersistedCheckpointWire,
  RestorePreviewResponse,
  ReviewResponse,
} from "@metaclanker/contracts/wire";

import type { ClientAtomModel } from "../../shared/client/create-client-atom-model.js";
import { clientErrorMessage, type ClientError } from "../../shared/client/errors.js";
import { Client, type RestoreFilesInput } from "../../shared/client/http.js";

type ReviewResult = AsyncResult.AsyncResult<ReviewResponse, ClientError>;
type PreviewResult = AsyncResult.AsyncResult<RestorePreviewResponse, ClientError>;
type RestoreResult = typeof PersistedCheckpointWire.Type;
type RestoreInput = RestoreFilesInput & { readonly threadId: ThreadId };

export interface ReviewAtomModel {
  readonly reviewByThread: (threadId: ThreadId) => Atom.Atom<ReviewResult>;
  readonly previewByThread: (
    threadId: ThreadId,
  ) => (checkpointId: CheckpointId) => Atom.Atom<PreviewResult>;
  readonly emptyPreview: Atom.Atom<PreviewResult>;
  readonly restoreByCommand: (
    commandId: CommandId,
  ) => Atom.AtomResultFn<RestoreInput, RestoreResult, ClientError>;
  readonly refreshReview: (threadId: ThreadId) => void;
}

export const reviewAtomModelKey: InjectionKey<ReviewAtomModel> = Symbol(
  "@metaclanker/web/review-atom-model",
);

export const createReviewAtomModel = (client: ClientAtomModel): ReviewAtomModel => {
  const reviewByThread = Atom.family((threadId: ThreadId) =>
    client.runtime.atom(
      Effect.gen(function* () {
        const service = yield* Client;
        return yield* service.review(threadId);
      }),
    ),
  );
  const previewByThread = Atom.family((threadId: ThreadId) =>
    Atom.family((checkpointId: CheckpointId) =>
      client.runtime.atom(
        Effect.gen(function* () {
          const service = yield* Client;
          return yield* service.restorePreview(threadId, checkpointId);
        }),
      ),
    ),
  );
  const restoreByCommand = Atom.family((commandId: CommandId) =>
    client.runtime.fn((input: RestoreInput) =>
      Effect.gen(function* () {
        const service = yield* Client;
        return yield* service.restoreFiles(input.threadId, {
          commandId,
          checkpointId: input.checkpointId,
          confirmed: input.confirmed,
        });
      }),
    ),
  );
  const emptyPreview = Atom.make(AsyncResult.initial<RestorePreviewResponse, ClientError>());

  return {
    reviewByThread,
    previewByThread,
    emptyPreview,
    restoreByCommand,
    refreshReview: (threadId) => client.registry.refresh(reviewByThread(threadId)),
  };
};

const injectReviewAtomModel = (): ReviewAtomModel => {
  const model = inject(reviewAtomModelKey);
  if (model === undefined) {
    throw new Error("MetaClanker review atom model was not provided for this app mount");
  }
  return model;
};

const resultValue = <A>(result: AsyncResult.AsyncResult<A, ClientError>): A | null => {
  if (AsyncResult.isSuccess(result)) return result.value;
  if (AsyncResult.isFailure(result) && Option.isSome(result.previousSuccess)) {
    return result.previousSuccess.value.value;
  }
  return null;
};

const resultMessage = <A>(result: AsyncResult.AsyncResult<A, ClientError>): string | null => {
  if (!AsyncResult.isFailure(result) || Cause.hasInterruptsOnly(result.cause)) return null;
  const failure: Option.Option<ClientError> = Cause.findErrorOption(result.cause);
  return Option.isSome(failure)
    ? clientErrorMessage(failure.value)
    : "The client operation failed unexpectedly.";
};

export interface UseReviewModelOptions {
  readonly threadId: () => ThreadId;
  readonly onRestored: () => void;
  readonly onClose: () => void;
}

export const useReviewModel = (options: UseReviewModelOptions) => {
  const model = injectReviewAtomModel();
  const reviewResult = useAtomValue(() => model.reviewByThread(options.threadId()));
  const selectedCheckpointId = ref<CheckpointId | null>(null);
  const confirmed = ref(false);
  const commandId = ref(CommandId.make(crypto.randomUUID()));
  const previewResult = useAtomValue(() => {
    const checkpointId = selectedCheckpointId.value;
    return checkpointId === null
      ? model.emptyPreview
      : model.previewByThread(options.threadId())(checkpointId);
  });
  const restoreAtom = () => model.restoreByCommand(commandId.value);
  const restoreResult = useAtomValue(restoreAtom);
  const dispatchRestore = useAtomSet(restoreAtom, { mode: "promiseExit" });
  let waiter: AbortController | null = null;

  const review = computed(() => resultValue(reviewResult.value));
  const preview = computed(() => resultValue(previewResult.value));
  const preTurnCheckpoints = computed(
    () =>
      review.value?.checkpoints.filter((record) => record.kind === "pre-turn").toReversed() ?? [],
  );
  const pending = computed(() => review.value === null && reviewResult.value.waiting);
  const refreshing = computed(() => review.value !== null && reviewResult.value.waiting);
  const previewing = computed(() => previewResult.value.waiting);
  const restoring = computed(() => restoreResult.value.waiting);
  const busy = computed(() => restoring.value || previewing.value);
  const message = computed(
    () =>
      resultMessage(restoreResult.value) ??
      resultMessage(previewResult.value) ??
      resultMessage(reviewResult.value),
  );
  const previewRows = computed(() => [
    { label: "review.additions", value: preview.value?.additions.length ?? 0 },
    { label: "review.modifications", value: preview.value?.modifications.length ?? 0 },
    { label: "review.deletions", value: preview.value?.deletions.length ?? 0 },
    {
      label: "review.ignoredFiles",
      value: preview.value?.includesIgnoredFiles ? "review.yes" : "review.no",
      translateValue: true,
    },
  ]);

  const refresh = (): void => model.refreshReview(options.threadId());

  /**
   * Minting a new `CommandId` swaps the restore atom, disposes the old node, and
   * interrupts its fiber. The server may already have accepted the destructive
   * restore, so dropping the fiber does not cancel the command — it only hides the
   * outcome. Refuse the selection instead.
   */
  const selectCheckpoint = (checkpointId: CheckpointId): void => {
    if (restoreResult.value.waiting) return;
    confirmed.value = false;
    selectedCheckpointId.value = checkpointId;
    commandId.value = CommandId.make(crypto.randomUUID());
  };

  const restore = async (): Promise<void> => {
    const checkpointId = selectedCheckpointId.value;
    if (!confirmed.value || checkpointId === null || restoreResult.value.waiting) return;
    waiter?.abort();
    waiter = new AbortController();
    const exit = await dispatchRestore(
      {
        threadId: options.threadId(),
        commandId: commandId.value,
        checkpointId,
        confirmed: true,
      },
      { signal: waiter.signal },
    );
    waiter = null;
    if (Exit.isSuccess(exit)) {
      options.onRestored();
      options.onClose();
    }
  };

  onUnmounted(() => waiter?.abort());

  return {
    review,
    preview,
    preTurnCheckpoints,
    selectedCheckpointId,
    confirmed,
    pending,
    refreshing,
    previewing,
    restoring,
    busy,
    message,
    previewRows,
    refresh,
    selectCheckpoint,
    restore,
  };
};
