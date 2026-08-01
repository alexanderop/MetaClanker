export interface SerialConsumer<T> {
  readonly push: (produce: () => Promise<T>) => void;
  readonly drain: () => Promise<void>;
}

/** Serializes async boundary decoding so cursor order is also application order. */
export const createSerialConsumer = <T>(
  consume: (value: T) => void | Promise<void>,
  onError: (cause: unknown) => void = () => undefined,
): SerialConsumer<T> => {
  let pending = Promise.resolve();
  return {
    push: (produce) => {
      pending = pending.then(produce).then(consume).catch(onError);
    },
    drain: () => pending,
  };
};
