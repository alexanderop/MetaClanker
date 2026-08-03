import * as Effect from "effect/Effect";

import { Store } from "@metaclanker/application/commands";
import type { StoreError } from "@metaclanker/application/ports";
import type { Sequence } from "@metaclanker/contracts/ids";
import type { SequencedServerEvent } from "@metaclanker/contracts/wire";
import type { DomainEvent } from "@metaclanker/domain/events";

const replayLimit = 10_000;
const pageSize = 256;

export interface EventReplay {
  readonly complete: boolean;
  readonly cursor: Sequence;
  readonly events: ReadonlyArray<SequencedServerEvent>;
}

/** Reads a bounded, ordered slice of the canonical journal for one live projection. */
export const readEventReplay = (
  afterSequence: Sequence,
  project: (event: DomainEvent) => SequencedServerEvent | null,
): Effect.Effect<EventReplay, StoreError, Store> =>
  Effect.gen(function* () {
    const store = yield* Store;
    let cursor = afterSequence;
    let inspected = 0;
    const events: Array<SequencedServerEvent> = [];
    while (inspected < replayLimit) {
      const page = yield* store.readEvents(cursor, pageSize);
      if (page.length === 0) break;
      inspected += page.length;
      for (const event of page) {
        cursor = event.sequence;
        const projected = project(event);
        if (projected !== null) events.push(projected);
      }
      if (page.length < pageSize) break;
    }
    return { complete: inspected < replayLimit, cursor, events };
  });
