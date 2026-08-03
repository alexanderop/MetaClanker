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
    // Each of these used to be salvaged field by field, producing a scenario the caller
    // never described instead of the deterministic default.
    expect(scenarioFromEnvironment('{"prompt":{"mode":"unknown"}}')).toEqual(acpScenario());
    expect(scenarioFromEnvironment("not json at all")).toEqual(acpScenario());
    expect(scenarioFromEnvironment(JSON.stringify({ crashAt: "midway" }))).toEqual(acpScenario());
    expect(
      scenarioFromEnvironment(
        JSON.stringify({ ...acpScenario(), models: ["only-real"], metadataMode: "unsupported" }),
      ),
    ).toEqual(acpScenario());
  });

  it("round-trips a complete scenario across the process boundary", () => {
    const scenario = acpScenario({
      prompt: { mode: "event-overflow", message: "overflow" },
      crashAt: "initialize-hang",
      models: ["fake-fast"],
      requiredMode: "plan",
      metadataMode: "invalid-codex",
    });

    expect(scenarioFromEnvironment(JSON.stringify(scenario))).toEqual(scenario);
  });
});
