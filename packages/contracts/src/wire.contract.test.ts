import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { ResourceUri } from "./wire.js";

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
