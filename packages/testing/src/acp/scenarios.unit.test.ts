import { describe, expect, it } from "vitest";

import { acpScenario, scenarioFromEnvironment } from "./scenarios.js";

describe("deterministic ACP scenarios", () => {
  it("keeps omitted settings on the explicit deterministic defaults", () => {
    expect(acpScenario({ prompt: { mode: "complete" } })).toMatchObject({
      protocolVersion: 1,
      sessionCapabilities: { close: true, resume: true, load: false, delete: false },
      prompt: { mode: "complete" },
      crashAt: null,
    });
  });

  it("rejects malformed environment configuration rather than changing the fake behavior", () => {
    expect(scenarioFromEnvironment('{"prompt":{"mode":"unknown"}}')).toEqual(acpScenario());
  });
});
