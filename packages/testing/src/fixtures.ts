import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const withTemporaryDirectory = async <A>(use: (path: string) => Promise<A>): Promise<A> => {
  const directory = await mkdtemp(join(tmpdir(), "metaclanker-test-"));
  return use(directory).finally(() => rm(directory, { recursive: true, force: true }));
};
