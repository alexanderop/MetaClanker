import { describe, expect, it } from "vitest";

import { createByteBoundedLru } from "./byte-bounded-lru.js";

describe("byte-bounded LRU", () => {
  it("evicts least-recently-used values to satisfy both limits", () => {
    const cache = createByteBoundedLru<string, string>({
      maximumEntries: 3,
      maximumBytes: 8,
      measure: (key, value) => key.length + value.length,
    });
    cache.set("a", "11");
    cache.set("b", "22");
    expect(cache.get("a")).toBe("11");
    cache.set("c", "33");

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("11");
    expect(cache.statistics()).toEqual({ entries: 2, retainedBytes: 6 });
  });

  it("does not retain a value larger than the entire byte budget", () => {
    const cache = createByteBoundedLru<string, string>({
      maximumEntries: 2,
      maximumBytes: 4,
      measure: (_key, value) => value.length,
    });
    cache.set("large", "12345");
    expect(cache.statistics()).toEqual({ entries: 0, retainedBytes: 0 });
  });
});
