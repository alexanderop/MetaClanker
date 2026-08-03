import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const FakePromptMode = Schema.Literals([
  "complete",
  "permission",
  "crash",
  "malformed-frame",
  "event-overflow",
]);
export type FakePromptMode = typeof FakePromptMode.Type;

const FakeCrashPoint = Schema.Literals(["initialize", "initialize-hang", "session-new", "prompt"]);
export type FakeCrashPoint = typeof FakeCrashPoint.Type;

/**
 * Configuration for the deterministic ACP executable. It is deliberately a data-only
 * contract so production ACP tests exercise a real child process. One schema declares
 * the shape, decodes it on the far side of the process boundary, and derives the type;
 * the literal sets used to live twice, so a new mode parsed as a silent default.
 */
export const AcpScenario = Schema.Struct({
  protocolVersion: Schema.Number,
  sessionCapabilities: Schema.Struct({
    close: Schema.Boolean,
    resume: Schema.Boolean,
    load: Schema.Boolean,
    delete: Schema.Boolean,
  }),
  prompt: Schema.Struct({ mode: FakePromptMode, message: Schema.String }),
  models: Schema.Array(Schema.String),
  modes: Schema.Array(Schema.String),
  requiredMode: Schema.NullOr(Schema.String),
  crashAt: Schema.NullOr(FakeCrashPoint),
  metadataMode: Schema.Literals(["none", "invalid-codex"]),
});
export type AcpScenario = typeof AcpScenario.Type;

/**
 * A caller may describe only the parts of a scenario it cares about, but a part it does
 * describe has to be valid: the old field-by-field salvage dropped a bad field and kept
 * the rest, silently running a scenario nobody asked for.
 */
const AcpScenarioOverrides = Schema.Struct({
  protocolVersion: Schema.optionalKey(Schema.Number),
  sessionCapabilities: Schema.optionalKey(
    Schema.Struct({
      close: Schema.optionalKey(Schema.Boolean),
      resume: Schema.optionalKey(Schema.Boolean),
      load: Schema.optionalKey(Schema.Boolean),
      delete: Schema.optionalKey(Schema.Boolean),
    }),
  ),
  prompt: Schema.optionalKey(
    Schema.Struct({
      mode: Schema.optionalKey(FakePromptMode),
      message: Schema.optionalKey(Schema.String),
    }),
  ),
  models: Schema.optionalKey(Schema.Array(Schema.String)),
  modes: Schema.optionalKey(Schema.Array(Schema.String)),
  requiredMode: Schema.optionalKey(Schema.NullOr(Schema.String)),
  crashAt: Schema.optionalKey(Schema.NullOr(FakeCrashPoint)),
  metadataMode: Schema.optionalKey(Schema.Literals(["none", "invalid-codex"])),
});
export type AcpScenarioOverrides = typeof AcpScenarioOverrides.Type;

const defaults: AcpScenario = {
  protocolVersion: 1,
  sessionCapabilities: { close: true, resume: true, load: false, delete: false },
  prompt: {
    mode: "permission",
    message: "I’ll inspect the project and make the requested change.",
  },
  models: ["fake-fast", "fake-deep"],
  modes: ["default"],
  requiredMode: null,
  crashAt: null,
  metadataMode: "none",
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
  modes: overrides.modes ?? defaults.modes,
  requiredMode: overrides.requiredMode ?? defaults.requiredMode,
  crashAt: overrides.crashAt ?? defaults.crashAt,
  metadataMode: overrides.metadataMode ?? defaults.metadataMode,
});

const decodeOverrides = Schema.decodeUnknownOption(Schema.fromJsonString(AcpScenarioOverrides));

/** Invalid external configuration falls back to the deterministic default as a whole. */
export const scenarioFromEnvironment = (value: string | undefined): AcpScenario => {
  if (value === undefined) return defaults;
  const decoded = decodeOverrides(value);
  return Option.isSome(decoded) ? acpScenario(decoded.value) : defaults;
};
