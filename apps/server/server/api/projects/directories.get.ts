import { realpath, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import * as Effect from "effect/Effect";
import { createError, getQuery, type H3Event } from "h3";

import {
  configuredProjectBrowserRoots,
  isWithinProjectBrowserRoot,
} from "../../utils/directory-browser.js";
import { defineApiHandler } from "../../utils/http.js";

const directoryListing = (event: H3Event) =>
  Effect.gen(function* () {
    const { roots, target } = yield* Effect.tryPromise({
      try: async () => {
        const resolvedRoots = await Promise.all(
          configuredProjectBrowserRoots().map((root) => realpath(root)),
        );
        const requested = getQuery(event)["path"];
        const resolvedTarget = await realpath(
          typeof requested === "string" ? requested : (resolvedRoots[0] ?? process.cwd()),
        );
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

export default defineApiHandler((event) => Effect.runPromise(directoryListing(event)));
