import type { SequencedServerEvent, ServerEvent } from "@metaclanker/contracts/wire";

export const replaySocketBufferLimit = 512;

interface ReplaySocketStateOptions {
  readonly send: (event: SequencedServerEvent) => void;
  readonly overflow: () => void;
  readonly bufferLimit?: number;
}

export interface ReplaySocketState {
  readonly push: (event: ServerEvent) => void;
  readonly synchronize: (cursor: number, replayed: ReadonlySet<number>) => boolean;
  readonly stop: () => void;
}

/** Owns a bounded replay-to-live overlap buffer for one WebSocket peer. */
export const createReplaySocketState = ({
  send,
  overflow,
  bufferLimit = replaySocketBufferLimit,
}: ReplaySocketStateOptions): ReplaySocketState => {
  let accepting = true;
  let synchronized = false;
  let buffered: SequencedServerEvent[] = [];

  const stop = (): void => {
    accepting = false;
    buffered = [];
  };

  return {
    push: (event) => {
      if (!accepting || event.type === "snapshot-required") return;
      if (synchronized) {
        send(event);
        return;
      }
      if (buffered.length >= bufferLimit) {
        stop();
        overflow();
        return;
      }
      buffered.push(event);
    },
    synchronize: (cursor, replayed) => {
      if (!accepting) return false;
      for (const event of buffered.toSorted((left, right) => left.sequence - right.sequence)) {
        if (event.sequence <= cursor || replayed.has(event.sequence)) continue;
        send(event);
      }
      buffered = [];
      synchronized = true;
      return true;
    },
    stop,
  };
};
