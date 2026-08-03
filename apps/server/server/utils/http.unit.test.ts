import { describe, expect, it } from "vitest";

import { ApplicationError } from "@metaclanker/application/commands";
import { ProjectPathError } from "@metaclanker/application/ports";

import { publicError } from "./http.js";

describe("publicError", () => {
  it("maps validated application and project errors", () => {
    const application = publicError(
      new ApplicationError({ code: "not-found", message: "Thread not found" }),
    );
    expect(application.statusCode).toBe(404);
    expect(application.message).toBe("Thread not found");

    const project = publicError(new ProjectPathError({ path: "/missing", reason: "not-found" }));
    expect(project.statusCode).toBe(422);
    expect(project.message).toBe("That server path does not exist");
  });

  it("does not trust malformed tagged-error lookalikes", () => {
    const malformedApplication = publicError({
      _tag: "ApplicationError",
      code: "sqlite-open-failed",
      message: "private database path",
    });
    expect(malformedApplication.statusCode).toBe(500);
    expect(malformedApplication.message).toBe("Operation failed");

    const malformedProject = publicError({
      _tag: "ProjectPathError",
      path: "/private/project",
      reason: "unexpected-private-reason",
    });
    expect(malformedProject.statusCode).toBe(500);
    expect(malformedProject.message).toBe("Operation failed");
  });
});
