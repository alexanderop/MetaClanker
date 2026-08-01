import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { Context, Data, Effect, Layer } from "effect";

import type {
  Checkpoint,
  CheckpointError,
  CheckpointFile,
  Checkpoints,
  ProjectFiles,
  ProjectPathError,
  RestorePreview,
  WorkspaceDiff,
} from "@metaclanker/application/ports";
import { Files } from "@metaclanker/application/commands";

const execFilePromise = promisify(execFile);

const workspaceStatus = (dirty: boolean | null): "clean" | "dirty" | "unavailable" => {
  if (dirty === null) return "unavailable";
  return dirty ? "dirty" : "clean";
};

class LiveCheckpointError extends Data.TaggedError("CheckpointError")<{
  readonly operation: CheckpointError["operation"];
  readonly message: string;
}> {}

class ProjectValidationFailure extends Error {
  readonly reason: "not-absolute" | "not-directory";

  constructor(reason: "not-absolute" | "not-directory") {
    super(reason);
    this.reason = reason;
  }
}

const failure = (operation: CheckpointError["operation"], cause: unknown): CheckpointError =>
  new LiveCheckpointError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const isWithin = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
};

const validateRoot = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      if (!isAbsolute(path)) {
        throw new Error("Project paths must be absolute");
      }
      const resolved = await realpath(path);
      const metadata = await stat(resolved);
      if (!metadata.isDirectory()) {
        throw new Error("Project path is not a directory");
      }
      await access(resolved, constants.R_OK | constants.W_OK);
      return resolved;
    },
    catch: (cause) => failure("capture", cause),
  });

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      const result = await execFilePromise("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      });
      return result.stdout.trim();
    },
    catch: (cause) => cause,
  });

const listRelativeFiles = (root: string, excludedRoot: string) =>
  Effect.tryPromise({
    try: async () => {
      const files: string[] = [];
      const visit = async (directory: string): Promise<void> => {
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === ".git" || entry.name === "node_modules") {
            continue;
          }
          const absolute = join(directory, entry.name);
          if (isWithin(excludedRoot, absolute)) {
            continue;
          }
          const relativePath = relative(root, absolute);
          if (entry.isDirectory()) {
            await visit(absolute);
            continue;
          }
          if (entry.isFile() || entry.isSymbolicLink()) {
            files.push(relativePath);
          }
        }
      };
      await visit(root);
      return files.toSorted();
    },
    catch: (cause) => failure("capture", cause),
  });

const gitFileKinds = (root: string) =>
  Effect.gen(function* () {
    const status = yield* git(root, [
      "status",
      "--porcelain=v1",
      "--ignored",
      "-z",
      "--untracked-files=all",
    ]).pipe(Effect.catchAll(() => Effect.succeed("")));
    const kinds = new Map<string, CheckpointFile["kind"]>();
    const records = status.split("\0").filter((record) => record.length >= 4);
    for (const record of records) {
      const code = record.slice(0, 2);
      const path = record.slice(3);
      if (code === "!!") {
        kinds.set(path, "ignored");
      } else if (code === "??") {
        kinds.set(path, "untracked");
      } else if (code[0] !== " ") {
        kinds.set(path, "staged");
      } else {
        kinds.set(path, "tracked");
      }
    }
    return kinds;
  });

const loadCheckpointFiles = (checkpoint: Checkpoint) =>
  Effect.forEach(
    checkpoint.files,
    (file) =>
      Effect.tryPromise({
        try: async () => {
          const path = join(checkpoint.snapshotPath, "files", file.path);
          const metadata = await lstat(path);
          const content = metadata.isSymbolicLink()
            ? Buffer.from(await readlink(path))
            : await readFile(path);
          return [
            file.path,
            {
              content,
              size: metadata.size,
              type: metadata.isSymbolicLink() ? "symlink" : "file",
            },
          ] as const;
        },
        catch: (cause) => failure("diff", cause),
      }),
    { concurrency: 8 },
  ).pipe(Effect.map((entries) => new Map(entries)));

const compareCheckpoints = (before: Checkpoint, after: Checkpoint) =>
  Effect.gen(function* () {
    const beforeData = yield* loadCheckpointFiles(before);
    const afterData = yield* loadCheckpointFiles(after);
    const paths = new Set([...beforeData.keys(), ...afterData.keys()]);
    const files: WorkspaceDiff["files"][number][] = [];
    for (const path of [...paths].toSorted()) {
      const previous = beforeData.get(path);
      const next = afterData.get(path);
      if (previous === undefined && next !== undefined) {
        files.push({ path, status: "added", beforeSize: 0, afterSize: next.size });
        continue;
      }
      if (previous !== undefined && next === undefined) {
        files.push({ path, status: "deleted", beforeSize: previous.size, afterSize: 0 });
        continue;
      }
      if (
        previous !== undefined &&
        next !== undefined &&
        (previous.type !== next.type || !previous.content.equals(next.content))
      ) {
        files.push({
          path,
          status: "modified",
          beforeSize: previous.size,
          afterSize: next.size,
        });
      }
    }
    return { files } satisfies WorkspaceDiff;
  });

const makeCheckpoints = (storageRoot: string): Checkpoints => {
  const capture: Checkpoints["capture"] = (projectPath) =>
    Effect.gen(function* () {
      const root = yield* validateRoot(projectPath);
      const id = crypto.randomUUID();
      const checkpointRoot = join(storageRoot, id);
      const filesRoot = join(checkpointRoot, "files");
      yield* Effect.tryPromise({
        try: () => mkdir(filesRoot, { recursive: true }),
        catch: (cause) => failure("capture", cause),
      });
      const excludedRoot = yield* Effect.tryPromise({
        try: () => realpath(storageRoot),
        catch: (cause) => failure("capture", cause),
      });
      const paths = yield* listRelativeFiles(root, excludedRoot);
      const kinds = yield* gitFileKinds(root);
      const files = yield* Effect.forEach(
        paths,
        (path) =>
          Effect.tryPromise({
            try: async () => {
              const source = resolve(root, path);
              const destination = resolve(filesRoot, path);
              if (!isWithin(root, source) || !isWithin(filesRoot, destination)) {
                throw new Error(`Refusing to capture path outside project: ${path}`);
              }
              const metadata = await lstat(source);
              await mkdir(resolve(destination, ".."), { recursive: true });
              await cp(source, destination, { dereference: false, preserveTimestamps: true });
              return {
                path,
                size: metadata.size,
                kind: kinds.get(path) ?? "tracked",
              } satisfies CheckpointFile;
            },
            catch: (cause) => failure("capture", cause),
          }),
        { concurrency: 8 },
      );
      const checkpoint: Checkpoint = {
        id,
        projectPath: root,
        createdAt: new Date().toISOString(),
        files,
        snapshotPath: checkpointRoot,
      };
      yield* Effect.tryPromise({
        try: () => writeFile(join(checkpointRoot, "checkpoint.json"), JSON.stringify(checkpoint)),
        catch: (cause) => failure("capture", cause),
      });
      return checkpoint;
    }).pipe(Effect.mapError((cause) => failure("capture", cause)));

  const previewRestore: Checkpoints["previewRestore"] = (checkpoint) =>
    Effect.gen(function* () {
      const current = yield* capture(checkpoint.projectPath);
      const workspaceDiff = yield* compareCheckpoints(current, checkpoint);
      const checkpointByPath = new Map(checkpoint.files.map((file) => [file.path, file]));
      const currentByPath = new Map(current.files.map((file) => [file.path, file]));
      const preview: RestorePreview = {
        additions: workspaceDiff.files
          .filter((file) => file.status === "added")
          .flatMap((file) => checkpointByPath.get(file.path) ?? []),
        modifications: workspaceDiff.files
          .filter((file) => file.status === "modified")
          .flatMap((file) => checkpointByPath.get(file.path) ?? []),
        deletions: workspaceDiff.files
          .filter((file) => file.status === "deleted")
          .flatMap((file) => currentByPath.get(file.path) ?? []),
        includesIgnoredFiles: [...checkpoint.files, ...current.files].some(
          (file) => file.kind === "ignored",
        ),
      };
      return preview;
    }).pipe(Effect.mapError((cause) => failure("preview", cause)));

  return {
    capture,
    diff: (before, after) =>
      compareCheckpoints(before, after).pipe(Effect.mapError((cause) => failure("diff", cause))),
    previewRestore,
    restore: (checkpoint) =>
      Effect.gen(function* () {
        const root = yield* validateRoot(checkpoint.projectPath);
        const undo = yield* capture(root);
        const excludedRoot = yield* Effect.tryPromise({
          try: () => realpath(storageRoot),
          catch: (cause) => failure("restore", cause),
        });
        const currentPaths = yield* listRelativeFiles(root, excludedRoot);
        const snapshotPaths = new Set(checkpoint.files.map((file) => file.path));

        yield* Effect.forEach(
          currentPaths.filter((path) => !snapshotPaths.has(path)),
          (path) =>
            Effect.tryPromise({
              try: async () => {
                const target = resolve(root, path);
                if (!isWithin(root, target)) {
                  throw new Error(`Refusing to remove path outside project: ${path}`);
                }
                await rm(target, { force: true, recursive: true });
              },
              catch: (cause) => failure("restore", cause),
            }),
          { concurrency: 8 },
        );

        yield* Effect.forEach(
          checkpoint.files,
          (file) =>
            Effect.tryPromise({
              try: async () => {
                const source = resolve(checkpoint.snapshotPath, "files", file.path);
                const destination = resolve(root, file.path);
                if (!isWithin(checkpoint.snapshotPath, source) || !isWithin(root, destination)) {
                  throw new Error(`Refusing to restore path outside project: ${file.path}`);
                }
                await mkdir(resolve(destination, ".."), { recursive: true });
                await cp(source, destination, { dereference: false, preserveTimestamps: true });
              },
              catch: (cause) => failure("restore", cause),
            }),
          { concurrency: 8 },
        );
        return undo;
      }).pipe(Effect.mapError((cause) => failure("restore", cause))),
  };
};

export const checkpointsLayer = (storageRoot: string) =>
  Layer.succeed(CheckpointsService, makeCheckpoints(storageRoot));

export class CheckpointsService extends Context.Tag("@metaclanker/git/Checkpoints")<
  CheckpointsService,
  Checkpoints
>() {}

const projectFiles: ProjectFiles = {
  validateProject: (path) =>
    Effect.tryPromise({
      try: async () => {
        if (!isAbsolute(path)) {
          throw new ProjectValidationFailure("not-absolute");
        }
        const resolved = await realpath(path);
        const metadata = await stat(resolved);
        if (!metadata.isDirectory()) {
          throw new ProjectValidationFailure("not-directory");
        }
        await access(resolved, constants.R_OK | constants.W_OK);
        const branch = await execFilePromise("git", ["branch", "--show-current"], {
          cwd: resolved,
          encoding: "utf8",
        }).then(
          (result) => result.stdout.trim() || null,
          () => null,
        );
        const dirty = await execFilePromise("git", ["status", "--porcelain=v1"], {
          cwd: resolved,
          encoding: "utf8",
        }).then(
          (result) => result.stdout.length > 0,
          () => null,
        );
        return { branch, status: workspaceStatus(dirty) } as const;
      },
      catch: (cause): ProjectPathError => {
        const reason =
          typeof cause === "object" && cause !== null && "reason" in cause
            ? String(cause.reason)
            : "not-found";
        if (reason === "not-absolute" || reason === "not-directory") {
          return { _tag: "ProjectPathError", path, reason };
        }
        return { _tag: "ProjectPathError", path, reason: "not-found" };
      },
    }),
};

export const projectFilesLayer = Layer.succeed(Files, projectFiles);
