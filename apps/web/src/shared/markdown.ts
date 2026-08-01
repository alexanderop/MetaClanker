import DOMPurify from "dompurify";
import { marked } from "marked";

import { createByteBoundedLru } from "./byte-bounded-lru.js";

marked.use({
  gfm: true,
  breaks: true,
});

const cacheLimit = 256;
const cacheByteLimit = 2 * 1024 * 1024;
const encoder = new TextEncoder();
const renderedCache = createByteBoundedLru<string, string>({
  maximumEntries: cacheLimit,
  maximumBytes: cacheByteLimit,
  measure: (source, rendered) =>
    encoder.encode(source).byteLength + encoder.encode(rendered).byteLength,
});

export const renderMarkdown = (source: string, cache = true): string => {
  const cached = renderedCache.get(source);
  if (cached !== undefined) {
    return cached;
  }
  const rendered = marked.parse(source, { async: false });
  const sanitized = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed"],
  });
  if (cache) renderedCache.set(source, sanitized);
  return sanitized;
};
