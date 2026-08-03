import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { afterEach, describe, expect, it } from "vitest";

import { CheckpointsService, checkpointsLayer } from "./checkpoints.js";

const temporaryDirectories: string[] = [];

const temporaryDirectory = async (prefix: string) => {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("workspace checkpoints", () => {
  it("excludes nested checkpoint storage and compares directory symlinks without following them", async () => {
    const project = await temporaryDirectory("metaclanker-project-");
    const storage = join(project, ".metaclanker-data", "checkpoints");
    await mkdir(join(project, "targets", "before"), { recursive: true });
    await mkdir(join(project, "targets", "after"), { recursive: true });
    await symlink(join("targets", "before"), join(project, "current"));
    const runtime = ManagedRuntime.make(checkpointsLayer(storage));

    const before = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.capture(project);
      }),
    );
    await rm(join(project, "current"));
    await symlink(join("targets", "after"), join(project, "current"));
    const after = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.capture(project);
      }),
    );
    const diff = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.diff(before, after);
      }),
    );
    await runtime.dispose();

    expect(before.files.some((file) => file.path.startsWith(".metaclanker-data/"))).toBe(false);
    expect(after.files.filter((file) => file.path.startsWith(".metaclanker-data/"))).toEqual([]);
    expect(diff.files.map((file) => [file.path, file.status])).toEqual([["current", "modified"]]);
  });

  it("previews and restores additions, modifications, and deletions within the project", async () => {
    const project = await temporaryDirectory("metaclanker-project-");
    const storage = await temporaryDirectory("metaclanker-checkpoints-");
    await mkdir(join(project, "src"));
    await writeFile(join(project, "src", "existing.txt"), "before");
    await writeFile(join(project, "remove-me.txt"), "remove me");
    const runtime = ManagedRuntime.make(checkpointsLayer(storage));

    const before = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.capture(project);
      }),
    );
    await writeFile(join(project, "src", "existing.txt"), "after");
    await rm(join(project, "remove-me.txt"));
    await writeFile(join(project, "added.txt"), "added");
    const after = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.capture(project);
      }),
    );
    const diff = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.diff(before, after);
      }),
    );
    const preview = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.previewRestore(before);
      }),
    );
    const undo = await runtime.runPromise(
      Effect.gen(function* () {
        const checkpoints = yield* CheckpointsService;
        return yield* checkpoints.restore(before);
      }),
    );
    await runtime.dispose();

    expect(diff.files.map((file) => [file.path, file.status])).toEqual([
      ["added.txt", "added"],
      ["remove-me.txt", "deleted"],
      ["src/existing.txt", "modified"],
    ]);
    expect(preview.modifications.map((file) => file.path)).toEqual(["src/existing.txt"]);
    expect(preview.deletions.map((file) => file.path)).toEqual(["added.txt"]);
    expect(preview.additions.map((file) => file.path)).toEqual(["remove-me.txt"]);
    expect(await readFile(join(project, "src", "existing.txt"), "utf8")).toBe("before");
    expect(await readFile(join(project, "remove-me.txt"), "utf8")).toBe("remove me");
    expect(undo.files.some((file) => file.path === "added.txt")).toBe(true);
  });
});
