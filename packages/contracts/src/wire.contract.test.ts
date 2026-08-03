import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  BackupResponse,
  ErrorResponse,
  HealthResponse,
  RemovedResponse,
  ResourceUri,
} from "./wire.js";

describe("resource URI wire contract", () => {
  it("accepts absolute resource identifiers and rejects relative or malformed values", () => {
    expect(Schema.decodeUnknownSync(ResourceUri)("file:///srv/project/notes.md")).toBe(
      "file:///srv/project/notes.md",
    );
    expect(
      Schema.decodeUnknownSync(ResourceUri)("urn:uuid:12345678-1234-1234-1234-123456789abc"),
    ).toBe("urn:uuid:12345678-1234-1234-1234-123456789abc");
    expect(() => Schema.decodeUnknownSync(ResourceUri)("notes.md")).toThrow();
    expect(() => Schema.decodeUnknownSync(ResourceUri)("https://")).toThrow();
  });
});

describe("public error wire contract", () => {
  it("rejects arbitrary internal error codes", () => {
    expect(() =>
      Schema.decodeUnknownSync(ErrorResponse)({
        error: { code: "sqlite-open-failed", message: "private detail" },
      }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(ErrorResponse)({
        error: { code: "internal", message: "Operation failed" },
      }),
    ).toEqual({ error: { code: "internal", message: "Operation failed" } });
  });
});

describe("operational response wire contracts", () => {
  it("accepts only the published health, backup, and removal shapes", () => {
    expect(
      Schema.decodeUnknownSync(HealthResponse)({
        status: "ready",
        protocolVersion: 1,
        serverTime: "2026-08-03T00:00:00.000Z",
      }),
    ).toEqual({
      status: "ready",
      protocolVersion: 1,
      serverTime: "2026-08-03T00:00:00.000Z",
    });
    expect(Schema.decodeUnknownSync(BackupResponse)({ fileName: "backup.sqlite" })).toEqual({
      fileName: "backup.sqlite",
    });
    expect(Schema.decodeUnknownSync(RemovedResponse)({ removed: true })).toEqual({ removed: true });
    expect(() => Schema.decodeUnknownSync(RemovedResponse)({ removed: false })).toThrow();
  });
});
