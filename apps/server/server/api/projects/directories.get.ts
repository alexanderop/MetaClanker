import { realpath, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { createError, defineEventHandler, getQuery } from "h3";

import {
  configuredProjectBrowserRoots,
  isWithinProjectBrowserRoot,
} from "../../utils/directory-browser.js";

export default defineEventHandler(async (event) => {
  try {
    const roots = await Promise.all(configuredProjectBrowserRoots().map((root) => realpath(root)));
    const requested = getQuery(event)["path"];
    const target = await realpath(
      typeof requested === "string" ? requested : (roots[0] ?? process.cwd()),
    );
    const containingRoot = roots.find((root) => isWithinProjectBrowserRoot(target, root));
    if (containingRoot === undefined) {
      throw createError({ statusCode: 403, statusMessage: "That directory is not available" });
    }
    const entries = await readdir(target, { withFileTypes: true });
    const directories = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map(async (entry) => {
          const path = await realpath(resolve(target, entry.name));
          return isWithinProjectBrowserRoot(path, containingRoot)
            ? { name: entry.name, path }
            : null;
        }),
    );
    const parent = dirname(target);
    return {
      currentPath: target,
      parentPath: target === containingRoot ? null : parent,
      entries: directories
        .filter((entry): entry is { name: string; path: string } => entry !== null)
        .toSorted((left, right) => left.name.localeCompare(right.name)),
      displayName: basename(target),
    };
  } catch (cause) {
    if (typeof cause === "object" && cause !== null && "statusCode" in cause) throw cause;
    throw createError({ statusCode: 422, statusMessage: "That server directory is not available" });
  }
});
