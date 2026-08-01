import type { AcpScenario } from "./scenarios.js";

export const fakeAcpEnvironment = (scenario: AcpScenario): Readonly<Record<string, string>> => ({
  METACLANKER_FAKE_ACP_SCENARIO: JSON.stringify(scenario),
});
