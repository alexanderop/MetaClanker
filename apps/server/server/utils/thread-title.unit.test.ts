import { describe, expect, it } from "vitest";

import { THREAD_TITLE_LIMIT, deriveThreadTitle } from "./thread-title.js";

describe("deriveThreadTitle", () => {
  it("normalizes whitespace in the first prompt", () => {
    expect(deriveThreadTitle("  Inspect\n\n  the workspace  ")).toBe("Inspect the workspace");
  });

  it("truncates long titles at the shared limit", () => {
    const title = deriveThreadTitle("word ".repeat(30));

    expect(title).toHaveLength(THREAD_TITLE_LIMIT);
    expect(title.endsWith("…")).toBe(true);
  });

  it("uses an attachment fallback when the first prompt is empty", () => {
    expect(deriveThreadTitle("", ["file:///tmp/design-notes.md"])).toBe(
      "Attachment: design-notes.md",
    );
  });
});
