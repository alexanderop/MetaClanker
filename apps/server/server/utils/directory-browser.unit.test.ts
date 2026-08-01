import { delimiter, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { configuredProjectBrowserRoots, isWithinProjectBrowserRoot } from "./directory-browser.js";

describe("server project browser containment", () => {
  it("accepts the configured root and descendants but rejects sibling prefixes", () => {
    const root = resolve("/srv/projects");

    expect(isWithinProjectBrowserRoot(root, root)).toBe(true);
    expect(isWithinProjectBrowserRoot(resolve(root, "nested/project"), root)).toBe(true);
    expect(isWithinProjectBrowserRoot(resolve("/srv/projects-private"), root)).toBe(false);
    expect(isWithinProjectBrowserRoot(resolve(root, "../secrets"), root)).toBe(false);
  });

  it("normalizes every explicitly configured root", () => {
    expect(configuredProjectBrowserRoots(["/srv/one", "/srv/two"].join(delimiter))).toEqual([
      resolve("/srv/one"),
      resolve("/srv/two"),
    ]);
  });
});
