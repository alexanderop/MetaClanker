import { describe, expect, it } from "vitest";

import { ApplicationError } from "@metaclanker/application/commands";

import { publicError } from "./http.js";

describe("publicError", () => {
  it("maps validated application errors", () => {
    const notFound = publicError(
      new ApplicationError({ code: "not-found", message: "Thread not found" }),
    );
    expect(notFound.statusCode).toBe(404);
    expect(notFound.message).toBe("Thread not found");

    // `ProjectPathError` no longer reaches this boundary: `packages/application` widens
    // it by tag, and `projects.unit.test.ts` owns the reason-to-message contract.
    const invalidProject = publicError(
      new ApplicationError({ code: "invalid-project", message: "That server path does not exist" }),
    );
    expect(invalidProject.statusCode).toBe(422);
    expect(invalidProject.message).toBe("That server path does not exist");
  });

  it("does not trust malformed tagged-error lookalikes", () => {
    const malformedApplication = publicError({
      _tag: "ApplicationError",
      code: "sqlite-open-failed",
      message: "private database path",
    });
    expect(malformedApplication.statusCode).toBe(500);
    expect(malformedApplication.message).toBe("Operation failed");
  });
});
