export interface ByteBoundedLruOptions<K, V> {
  readonly maximumEntries: number;
  readonly maximumBytes: number;
  readonly measure: (key: K, value: V) => number;
}

/** A small deterministic LRU whose retained memory is bounded by count and estimated bytes. */
export const createByteBoundedLru = <K, V>({
  maximumEntries,
  maximumBytes,
  measure,
}: ByteBoundedLruOptions<K, V>) => {
  const entries = new Map<K, { readonly value: V; readonly bytes: number }>();
  let retainedBytes = 0;

  const removeOldest = (): void => {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) return;
    const removed = entries.get(oldest);
    entries.delete(oldest);
    retainedBytes -= removed?.bytes ?? 0;
  };

  return {
    get: (key: K): V | undefined => {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set: (key: K, value: V): void => {
      const previous = entries.get(key);
      if (previous !== undefined) {
        entries.delete(key);
        retainedBytes -= previous.bytes;
      }
      const bytes = measure(key, value);
      if (bytes > maximumBytes) return;
      entries.set(key, { value, bytes });
      retainedBytes += bytes;
      for (;;) {
        if (entries.size <= maximumEntries && retainedBytes <= maximumBytes) break;
        removeOldest();
      }
    },
    statistics: () => ({ entries: entries.size, retainedBytes }),
  };
};
