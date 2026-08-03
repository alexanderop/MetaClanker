import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  cp,
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import type {
  Checkpoint,
  CheckpointFile,
  Checkpoints,
  ProjectFiles,
  RestorePreview,
  WorkspaceDiff,
} from "@metaclanker/application/ports";
import { CheckpointError, ProjectPathError } from "@metaclanker/application/ports";
import { Files } from "@metaclanker/application/commands";
import { CheckpointId } from "@metaclanker/contracts/ids";

const execFilePromise = promisify(execFile);

const workspaceStatus = (dirty: boolean | null): "clean" | "dirty" | "unavailable" => {
  if (dirty === null) return "unavailable";
  return dirty ? "dirty" : "clean";
};

const failure = (operation: CheckpointError["operation"], cause: unknown): CheckpointError =>
  new CheckpointError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
  });

const isWithin = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
};

/** `"not-readable"` was unreachable, so an `EACCES` project reported as not-found. */
const projectPathReason = (cause: unknown): ProjectPathError["reason"] => {
  const code =
    typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : "";
  if (code === "EACCES" || code === "EPERM") return "not-readable";
  if (code === "ENOTDIR") return "not-directory";
  return "not-found";
};

const validateProjectRoot = (path: string): Effect.Effect<string, ProjectPathError> =>
  Effect.gen(function* () {
    if (!isAbsolute(path)) {
      return yield* Effect.fail(new ProjectPathError({ path, reason: "not-absolute" }));
    }
    const resolved = yield* Effect.tryPromise({
      try: () => realpath(path),
      catch: (cause) => new ProjectPathError({ path, reason: projectPathReason(cause) }),
    });
    const metadata = yield* Effect.tryPromise({
      try: () => stat(resolved),
      catch: (cause) => new ProjectPathError({ path, reason: projectPathReason(cause) }),
    });
    if (!metadata.isDirectory()) {
      return yield* Effect.fail(new ProjectPathError({ path, reason: "not-directory" }));
    }
    yield* Effect.tryPromise({
      try: () => access(resolved, constants.R_OK | constants.W_OK),
      catch: (cause) => new ProjectPathError({ path, reason: projectPathReason(cause) }),
    });
    return resolved;
  });

/** Carries the caller's operation instead of relabelling every failure as a capture. */
const validateRoot = (path: string, operation: CheckpointError["operation"]) =>
  validateProjectRoot(path).pipe(
    Effect.mapError(
      (cause) => new CheckpointError({ operation, message: `Project path is ${cause.reason}` }),
    ),
  );

/**
 * `git` refusing to answer because the directory is not a repository is a truthful
 * empty result. Every other failure means the answer is unknown and must not be
 * fabricated — see `gitFileKinds`.
 */
class NotAGitRepository extends Schema.TaggedErrorClass<NotAGitRepository>()(
  "NotAGitRepository",
  {},
) {}

class GitCommandError extends Schema.TaggedErrorClass<GitCommandError>()("GitCommandError", {
  message: Schema.String,
}) {}

const GIT_TIMEOUT = "10 seconds";

const notARepository = /not a git repository/i;

const isNotARepositoryFailure = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "stderr" in cause &&
  typeof cause.stderr === "string" &&
  notARepository.test(cause.stderr);

/** Deliberately excludes stderr and stdout: both carry absolute paths and file contents. */
const gitFailureMessage = (args: ReadonlyArray<string>, cause: unknown): string => {
  const subcommand = args[0] ?? "";
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    return `git ${subcommand} failed with ${String(cause.code)}`;
  }
  return `git ${subcommand} failed`;
};

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: (signal) =>
      execFilePromise("git", args, {
        cwd,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        signal,
      }).then((result) => result.stdout.trim()),
    catch: (cause): NotAGitRepository | GitCommandError =>
      isNotARepositoryFailure(cause)
        ? new NotAGitRepository()
        : new GitCommandError({ message: gitFailureMessage(args, cause) }),
  }).pipe(
    Effect.timeout(GIT_TIMEOUT),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new GitCommandError({ message: `git ${args[0] ?? ""} timed out` })),
    ),
  );

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
    ]).pipe(
      // Not a repository means nothing is ignored, staged, or untracked. Any other
      // failure leaves the classification unknown, and reporting "no ignored files"
      // to a destructive-restore confirmation would be a lie.
      Effect.catchTag("NotAGitRepository", () => Effect.succeed("")),
      Effect.catchTag("GitCommandError", (cause) =>
        Effect.fail(new CheckpointError({ operation: "capture", message: cause.message })),
      ),
    );
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

const COMPARE_CHUNK_BYTES = 64 * 1024;

/**
 * Compares two snapshot entries without materializing either workspace. Reading both
 * sides in full only to call `.equals()` made peak memory the size of two workspaces.
 */
const sameSnapshotEntry = (left: string, right: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const [leftMetadata, rightMetadata] = await Promise.all([lstat(left), lstat(right)]);
      if (leftMetadata.isSymbolicLink() !== rightMetadata.isSymbolicLink()) return false;
      if (leftMetadata.size !== rightMetadata.size) return false;
      if (leftMetadata.isSymbolicLink()) {
        const [leftTarget, rightTarget] = await Promise.all([readlink(left), readlink(right)]);
        return leftTarget === rightTarget;
      }
      const [leftHandle, rightHandle] = await Promise.all([open(left, "r"), open(right, "r")]);
      try {
        const leftChunk = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
        const rightChunk = Buffer.allocUnsafe(COMPARE_CHUNK_BYTES);
        for (;;) {
          signal.throwIfAborted();
          const [leftRead, rightRead] = await Promise.all([
            leftHandle.read(leftChunk, 0, COMPARE_CHUNK_BYTES),
            rightHandle.read(rightChunk, 0, COMPARE_CHUNK_BYTES),
          ]);
          if (leftRead.bytesRead !== rightRead.bytesRead) return false;
          if (leftRead.bytesRead === 0) return true;
          if (
            !leftChunk
              .subarray(0, leftRead.bytesRead)
              .equals(rightChunk.subarray(0, rightRead.bytesRead))
          ) {
            return false;
          }
        }
      } finally {
        await Promise.all([leftHandle.close(), rightHandle.close()]);
      }
    },
    catch: (cause) => failure("diff", cause),
  });

const snapshotEntryPath = (checkpoint: Checkpoint, path: string): string =>
  join(checkpoint.snapshotPath, "files", path);

const compareCheckpoints = (before: Checkpoint, after: Checkpoint) =>
  Effect.gen(function* () {
    const beforeByPath = new Map(before.files.map((file) => [file.path, file]));
    const afterByPath = new Map(after.files.map((file) => [file.path, file]));
    const paths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].toSorted();
    const compared = yield* Effect.forEach(
      paths,
      (path) =>
        Effect.gen(function* () {
          const previous = beforeByPath.get(path);
          const next = afterByPath.get(path);
          if (previous === undefined) {
            return next === undefined
              ? []
              : [{ path, status: "added", beforeSize: 0, afterSize: next.size } as const];
          }
          if (next === undefined) {
            return [{ path, status: "deleted", beforeSize: previous.size, afterSize: 0 } as const];
          }
          const identical = yield* sameSnapshotEntry(
            snapshotEntryPath(before, path),
            snapshotEntryPath(after, path),
          );
          return identical
            ? []
            : [
                {
                  path,
                  status: "modified",
                  beforeSize: previous.size,
                  afterSize: next.size,
                } as const,
              ];
        }),
      { concurrency: 8 },
    );
    return { files: compared.flat() } satisfies WorkspaceDiff;
  });

/** Best-effort: the caller is already reporting a failure and must not be masked by it. */
const discardSnapshot = (snapshotPath: string) =>
  Effect.promise(() => rm(snapshotPath, { recursive: true, force: true }).catch(() => undefined));

const makeCheckpoints = (storageRoot: string): Checkpoints => {
  const captureInto = (projectPath: string, checkpointId: CheckpointId, checkpointRoot: string) =>
    Effect.gen(function* () {
      const root = yield* validateRoot(projectPath, "capture");
      const id = checkpointId;
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

  /**
   * A snapshot without its `checkpoint.json` is unusable and undiscoverable, and this is
   * the undo path for a destructive restore. A capture that fails or is interrupted takes
   * its partial directory with it.
   */
  const capture: Checkpoints["capture"] = (
    projectPath,
    checkpointId = CheckpointId.make(crypto.randomUUID()),
  ) => {
    const checkpointRoot = join(storageRoot, checkpointId);
    return Effect.onExit(captureInto(projectPath, checkpointId, checkpointRoot), (exit) =>
      Exit.isSuccess(exit) ? Effect.void : discardSnapshot(checkpointRoot),
    ).pipe(Effect.withSpan("checkpoints.capture"));
  };

  const previewRestore: Checkpoints["previewRestore"] = (checkpoint) =>
    // The comparison snapshot is a full copy of the workspace and nothing else ever
    // reads it, so it is released the moment the preview is computed.
    Effect.acquireUseRelease(
      capture(checkpoint.projectPath),
      (current) =>
        Effect.gen(function* () {
          const workspaceDiff = yield* compareCheckpoints(current, checkpoint);
          const checkpointByPath = new Map(checkpoint.files.map((file) => [file.path, file]));
          const currentByPath = new Map(current.files.map((file) => [file.path, file]));
          return {
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
          } satisfies RestorePreview;
        }),
      (current) => discardSnapshot(current.snapshotPath),
    ).pipe(
      Effect.mapError((cause) => failure("preview", cause)),
      Effect.withSpan("checkpoints.previewRestore"),
    );

  return {
    capture,
    diff: (before, after) =>
      compareCheckpoints(before, after).pipe(
        Effect.mapError((cause) => failure("diff", cause)),
        Effect.withSpan("checkpoints.diff"),
      ),
    previewRestore,
    restore: (checkpoint, undoCheckpointId) =>
      Effect.gen(function* () {
        const root = yield* validateRoot(checkpoint.projectPath, "restore");
        const undo = yield* capture(root, undoCheckpointId);
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
      }).pipe(
        Effect.mapError((cause) => failure("restore", cause)),
        Effect.withSpan("checkpoints.restore"),
      ),
  };
};

export const checkpointsLayer = (storageRoot: string) =>
  Layer.succeed(CheckpointsService, makeCheckpoints(storageRoot));

export class CheckpointsService extends Context.Service<CheckpointsService, Checkpoints>()(
  "@metaclanker/git/Checkpoints",
) {}

const projectFiles: ProjectFiles = {
  validateProject: Effect.fn("Files.validateProject")(function* (path: string) {
    const resolved = yield* validateProjectRoot(path);
    // Unlike ignored-file classification, "unavailable" is a truthful answer here: the
    // caller is told the workspace state is unknown rather than shown a fabricated one.
    const branch = yield* git(resolved, ["branch", "--show-current"]).pipe(
      Effect.map((value) => (value.length === 0 ? null : value)),
      Effect.catch(() => Effect.succeed(null)),
    );
    const dirty = yield* git(resolved, ["status", "--porcelain=v1"]).pipe(
      Effect.map((value) => value.length > 0),
      Effect.catch(() => Effect.succeed(null)),
    );
    return { branch, status: workspaceStatus(dirty) } as const;
  }),
};

export const projectFilesLayer = Layer.succeed(Files, projectFiles);
