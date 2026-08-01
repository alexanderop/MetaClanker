import { describe, expect, it } from "vitest";

import { createSerialConsumer } from "./serial-consumer.js";

describe("serial consumer", () => {
  it("does not let a later fast decode overtake an earlier slow decode", async () => {
    const applied: number[] = [];
    const consumer = createSerialConsumer<number>((value) => {
      applied.push(value);
    });

    consumer.push(async () => {
      await Promise.resolve();
      return 1;
    });
    consumer.push(() => Promise.resolve(2));
    await consumer.drain();

    expect(applied).toEqual([1, 2]);
  });
});
