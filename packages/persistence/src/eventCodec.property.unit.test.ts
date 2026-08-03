import * as Schema from "effect/Schema";
// `@fast-check/vitest` bundles its own fast-check, and an arbitrary derived from an
// Effect schema belongs to Effect's copy. Both come from the same pinned versions here.
import * as FastCheck from "effect/testing/FastCheck";
import { describe, expect, it } from "vitest";

import { UnsequencedDomainEventSchema, eventThreadId } from "./eventCodec.js";

describe("persisted event journal", () => {
  it("round-trips every event variant through the one schema it is written with", () => {
    FastCheck.assert(
      FastCheck.property(Schema.toArbitrary(UnsequencedDomainEventSchema), (event) => {
        const stored = JSON.stringify(Schema.encodeSync(UnsequencedDomainEventSchema)(event));
        const restored = Schema.decodeUnknownSync(UnsequencedDomainEventSchema)(JSON.parse(stored));

        // The write path encodes and the read path decodes with this one schema, so a
        // value that cannot be read back cannot be written in the first place.
        expect(restored).toEqual(event);
        expect(eventThreadId(restored)).toEqual(eventThreadId(event));
      }),
    );
  });

  it("covers every declared variant", () => {
    expect(UnsequencedDomainEventSchema.discriminants).toHaveLength(13);
  });
});
