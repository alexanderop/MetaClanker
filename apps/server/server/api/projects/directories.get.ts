import { realpath, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import * as Effect from "effect/Effect";
import * as Config from "effect/Config";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { createError, getQuery, type H3Event } from "h3";

import { DirectoryBrowserQuery, DirectoryBrowserResponse } from "@metaclanker/contracts/wire";

import {
  configuredProjectBrowserRoots,
  isWithinProjectBrowserRoot,
} from "../../utils/directory-browser.js";
import { defineApiHandler, encodeResponse } from "../../utils/http.js";

const directoryListing = (event: H3Event) =>
  Effect.gen(function* () {
    const query = yield* Schema.decodeUnknownEffect(DirectoryBrowserQuery)(getQuery(event)).pipe(
      Effect.mapError(() => createError({ statusCode: 400, message: "Invalid directory query" })),
    );
    const configured = yield* Config.option(Config.string("METACLANKER_PROJECT_BROWSER_ROOTS"));
    const { roots, target } = yield* Effect.tryPromise({
      try: async () => {
        const resolvedRoots = await Promise.all(
          configuredProjectBrowserRoots(Option.getOrUndefined(configured)).map((root) =>
            realpath(root),
          ),
        );
        const resolvedTarget = await realpath(query.path ?? resolvedRoots[0] ?? process.cwd());
        return { roots: resolvedRoots, target: resolvedTarget };
      },
      catch: () =>
        createError({ statusCode: 422, message: "That server directory is not available" }),
    });
    const containingRoot = roots.find((root) => isWithinProjectBrowserRoot(target, root));
    if (containingRoot === undefined) {
      return yield* Effect.fail(
        createError({ statusCode: 403, message: "That directory is not available" }),
      );
    }
    const directories = yield* Effect.tryPromise({
      try: async () => {
        const entries = await readdir(target, { withFileTypes: true });
        return await Promise.all(
          entries
            .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
            .map(async (entry) => {
              const path = await realpath(resolve(target, entry.name));
              return isWithinProjectBrowserRoot(path, containingRoot)
                ? { name: entry.name, path }
                : null;
            }),
        );
      },
      catch: () =>
        createError({ statusCode: 422, message: "That server directory is not available" }),
    });
    const parent = dirname(target);
    return {
      currentPath: target,
      parentPath: target === containingRoot ? null : parent,
      entries: directories
        .filter((entry): entry is { name: string; path: string } => entry !== null)
        .toSorted((left, right) => left.name.localeCompare(right.name)),
      displayName: basename(target),
    };
  });

export default defineApiHandler((event) =>
  Effect.runPromise(directoryListing(event)).then((result) =>
    encodeResponse(DirectoryBrowserResponse, result),
  ),
);
