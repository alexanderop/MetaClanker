import { describe, expect, it } from "vitest";

import { applicationErrorFromProjectPath, applicationErrorFromStore } from "./commands.js";
import { ProjectPathError, StoreError } from "./ports.js";

describe("application error widening", () => {
  it("gives every project-path reason its own message", () => {
    const reasons = ["not-absolute", "not-found", "not-directory", "not-readable"] as const;
    const widened = reasons.map((reason) =>
      applicationErrorFromProjectPath(new ProjectPathError({ path: "/private/project", reason })),
    );

    expect(widened.map((error) => error.code)).toEqual(reasons.map(() => "invalid-project"));
    expect(widened.map((error) => error.message)).toEqual([
      "Enter an absolute server path",
      "That server path does not exist",
      "That server path is not a directory",
      "That server directory is not readable",
    ]);
    // The rejected path is diagnostic-only and never reaches the transport.
    expect(widened.some((error) => error.message.includes("/private/project"))).toBe(false);
  });

  it("keeps a store failure's code and shows its message unless it is opaque", () => {
    const conflict = applicationErrorFromStore(
      new StoreError({ code: "conflict", operation: "start turn", message: "Turn already active" }),
    );
    const persistence = applicationErrorFromStore(
      new StoreError({ code: "persistence", operation: "get thread", message: "disk failure" }),
    );

    expect(conflict).toMatchObject({ code: "conflict", message: "Turn already active" });
    // The HTTP edge replaces a persistence message, so the operation rides along for logs.
    expect(persistence).toMatchObject({ code: "persistence", message: "get thread: disk failure" });
  });
});
