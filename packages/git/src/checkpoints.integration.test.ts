import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe } from "vitest";

import { CheckpointError } from "@metaclanker/application/ports";

import { CheckpointsService, checkpointsLayer } from "./checkpoints.js";

const execFilePromise = promisify(execFile);

/** Tied to the test scope so a failing assertion cannot leak the directory. */
const temporaryDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), prefix))),
    (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );

const checkpointsIn = (storage: string) =>
  CheckpointsService.pipe(Effect.provide(checkpointsLayer(storage)));

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.promise(() => execFilePromise("git", args, { cwd, encoding: "utf8" }));

describe("workspace checkpoints", () => {
  it.live(
    "excludes nested checkpoint storage and compares directory symlinks without following them",
    () =>
      Effect.gen(function* () {
        const project = yield* temporaryDirectory("metaclanker-project-");
        const storage = join(project, ".metaclanker-data", "checkpoints");
        yield* Effect.promise(() => mkdir(join(project, "targets", "before"), { recursive: true }));
        yield* Effect.promise(() => mkdir(join(project, "targets", "after"), { recursive: true }));
        yield* Effect.promise(() => symlink(join("targets", "before"), join(project, "current")));
        const checkpoints = yield* checkpointsIn(storage);

        const before = yield* checkpoints.capture(project);
        yield* Effect.promise(() => rm(join(project, "current")));
        yield* Effect.promise(() => symlink(join("targets", "after"), join(project, "current")));
        const after = yield* checkpoints.capture(project);
        const diff = yield* checkpoints.diff(before, after);

        expect(before.files.some((file) => file.path.startsWith(".metaclanker-data/"))).toBe(false);
        expect(after.files.filter((file) => file.path.startsWith(".metaclanker-data/"))).toEqual(
          [],
        );
        expect(diff.files.map((file) => [file.path, file.status])).toEqual([
          ["current", "modified"],
        ]);
      }),
  );

  it.live("previews and restores additions, modifications, and deletions within the project", () =>
    Effect.gen(function* () {
      const project = yield* temporaryDirectory("metaclanker-project-");
      const storage = yield* temporaryDirectory("metaclanker-checkpoints-");
      yield* Effect.promise(() => mkdir(join(project, "src")));
      yield* Effect.promise(() => writeFile(join(project, "src", "existing.txt"), "before"));
      yield* Effect.promise(() => writeFile(join(project, "remove-me.txt"), "remove me"));
      const checkpoints = yield* checkpointsIn(storage);

      const before = yield* checkpoints.capture(project);
      yield* Effect.promise(() => writeFile(join(project, "src", "existing.txt"), "after"));
      yield* Effect.promise(() => rm(join(project, "remove-me.txt")));
      yield* Effect.promise(() => writeFile(join(project, "added.txt"), "added"));
      const after = yield* checkpoints.capture(project);
      const diff = yield* checkpoints.diff(before, after);
      const preview = yield* checkpoints.previewRestore(before);
      const undo = yield* checkpoints.restore(before);

      expect(diff.files.map((file) => [file.path, file.status])).toEqual([
        ["added.txt", "added"],
        ["remove-me.txt", "deleted"],
        ["src/existing.txt", "modified"],
      ]);
      expect(preview.modifications.map((file) => file.path)).toEqual(["src/existing.txt"]);
      expect(preview.deletions.map((file) => file.path)).toEqual(["added.txt"]);
      expect(preview.additions.map((file) => file.path)).toEqual(["remove-me.txt"]);
      expect(
        yield* Effect.promise(() => readFile(join(project, "src", "existing.txt"), "utf8")),
      ).toBe("before");
      expect(yield* Effect.promise(() => readFile(join(project, "remove-me.txt"), "utf8"))).toBe(
        "remove me",
      );
      expect(undo.files.some((file) => file.path === "added.txt")).toBe(true);
    }),
  );

  it.live("releases the comparison snapshot a restore preview captures", () =>
    Effect.gen(function* () {
      const project = yield* temporaryDirectory("metaclanker-project-");
      const storage = yield* temporaryDirectory("metaclanker-checkpoints-");
      yield* Effect.promise(() => writeFile(join(project, "tracked.txt"), "tracked"));
      const checkpoints = yield* checkpointsIn(storage);

      const before = yield* checkpoints.capture(project);
      const preview = yield* checkpoints.previewRestore(before);

      expect(preview.modifications).toEqual([]);
      // The preview copies the whole workspace to compare it; nothing else ever reads it.
      expect(yield* Effect.promise(() => readdir(storage))).toEqual([before.id]);
    }),
  );

  it.live("leaves no partial snapshot behind when a capture fails", () =>
    Effect.gen(function* () {
      const project = yield* temporaryDirectory("metaclanker-project-");
      const storage = yield* temporaryDirectory("metaclanker-checkpoints-");
      yield* Effect.promise(() => writeFile(join(project, "tracked.txt"), "tracked"));
      yield* git(project, ["init", "--quiet", "."]);
      yield* Effect.promise(() => writeFile(join(project, ".git", "config"), "[core\n"));
      const checkpoints = yield* checkpointsIn(storage);

      const failure = yield* Effect.flip(checkpoints.capture(project));

      expect(failure).toBeInstanceOf(CheckpointError);
      // A snapshot without its `checkpoint.json` is unusable, and this is the undo path.
      expect(yield* Effect.promise(() => readdir(storage))).toEqual([]);
    }),
  );

  it.live("fails the restore preview instead of reporting that no ignored files are affected", () =>
    Effect.gen(function* () {
      const project = yield* temporaryDirectory("metaclanker-project-");
      const storage = yield* temporaryDirectory("metaclanker-checkpoints-");
      yield* Effect.promise(() => writeFile(join(project, "tracked.txt"), "tracked"));
      yield* git(project, ["init", "--quiet", "."]);
      const checkpoints = yield* checkpointsIn(storage);

      const before = yield* checkpoints.capture(project);

      // The ignored file exists only in the current workspace, so restoring `before`
      // would delete it. The preview is the only thing telling the user that.
      yield* Effect.promise(() => writeFile(join(project, ".gitignore"), "build/\n"));
      yield* Effect.promise(() => mkdir(join(project, "build")));
      yield* Effect.promise(() => writeFile(join(project, "build", "output.bin"), "local"));

      const healthy = yield* checkpoints.previewRestore(before);
      expect(healthy.includesIgnoredFiles).toBe(true);

      yield* Effect.promise(() => writeFile(join(project, ".git", "config"), "[core\n"));

      const degraded = yield* checkpoints.previewRestore(before).pipe(Effect.flip);
      expect(degraded).toBeInstanceOf(CheckpointError);
      expect(degraded.message).toContain("git status failed");
      expect(degraded.message).not.toContain(project);
    }),
  );
});
