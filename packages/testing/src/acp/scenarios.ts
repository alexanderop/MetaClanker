export type FakePromptMode = "complete" | "permission" | "crash" | "malformed-frame";

export type FakeCrashPoint = "initialize" | "session-new" | "prompt";

/**
 * Configuration for the deterministic ACP executable. It is deliberately a
 * data-only contract so production ACP tests exercise a real child process.
 */
export interface AcpScenario {
  readonly protocolVersion: number;
  readonly sessionCapabilities: {
    readonly close: boolean;
    readonly resume: boolean;
    readonly load: boolean;
    readonly delete: boolean;
  };
  readonly prompt: {
    readonly mode: FakePromptMode;
    readonly message: string;
  };
  readonly models: ReadonlyArray<string>;
  readonly crashAt: FakeCrashPoint | null;
}

export type AcpScenarioOverrides = {
  readonly protocolVersion?: number;
  readonly sessionCapabilities?: Partial<AcpScenario["sessionCapabilities"]>;
  readonly prompt?: Partial<AcpScenario["prompt"]>;
  readonly models?: ReadonlyArray<string>;
  readonly crashAt?: FakeCrashPoint | null;
};

const defaults: AcpScenario = {
  protocolVersion: 1,
  sessionCapabilities: { close: true, resume: true, load: false, delete: false },
  prompt: {
    mode: "permission",
    message: "I’ll inspect the project and make the requested change.",
  },
  models: ["fake-fast", "fake-deep"],
  crashAt: null,
};

export const acpScenario = (overrides: AcpScenarioOverrides = {}): AcpScenario => ({
  protocolVersion: overrides.protocolVersion ?? defaults.protocolVersion,
  sessionCapabilities: {
    ...defaults.sessionCapabilities,
    ...overrides.sessionCapabilities,
  },
  prompt: {
    ...defaults.prompt,
    ...overrides.prompt,
  },
  models: overrides.models ?? defaults.models,
  crashAt: overrides.crashAt ?? defaults.crashAt,
});

const isPromptMode = (value: unknown): value is FakePromptMode =>
  value === "complete" ||
  value === "permission" ||
  value === "crash" ||
  value === "malformed-frame";

const isCrashPoint = (value: unknown): value is FakeCrashPoint =>
  value === "initialize" || value === "session-new" || value === "prompt";

/** Invalid external configuration falls back to the safe, deterministic default. */
export const scenarioFromEnvironment = (value: string | undefined): AcpScenario => {
  if (value === undefined) return defaults;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return defaults;
    const input = parsed as Record<string, unknown>;
    const capabilities = input["sessionCapabilities"];
    const prompt = input["prompt"];
    const capabilityOverrides =
      typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities)
        ? Object.fromEntries(
            Object.entries(capabilities).filter(
              ([key, item]) =>
                (key === "close" || key === "resume" || key === "load" || key === "delete") &&
                typeof item === "boolean",
            ),
          )
        : {};
    const promptRecord =
      typeof prompt === "object" && prompt !== null && !Array.isArray(prompt)
        ? (prompt as Record<string, unknown>)
        : null;
    const promptOverrides =
      promptRecord !== null
        ? {
            ...(isPromptMode(promptRecord["mode"]) ? { mode: promptRecord["mode"] } : {}),
            ...(typeof promptRecord["message"] === "string"
              ? { message: promptRecord["message"] }
              : {}),
          }
        : {};
    return acpScenario({
      ...(typeof input["protocolVersion"] === "number"
        ? { protocolVersion: input["protocolVersion"] }
        : {}),
      sessionCapabilities: capabilityOverrides,
      prompt: promptOverrides,
      ...(Array.isArray(input["models"]) &&
      input["models"].every((model) => typeof model === "string")
        ? { models: input["models"] }
        : {}),
      ...(input["crashAt"] === null || isCrashPoint(input["crashAt"])
        ? { crashAt: input["crashAt"] }
        : {}),
    });
  } catch {
    return defaults;
  }
};
