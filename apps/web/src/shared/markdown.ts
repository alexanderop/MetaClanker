import DOMPurify from "dompurify";
import { marked } from "marked";

marked.use({
  gfm: true,
  breaks: true,
});

export const renderMarkdown = (source: string): string => {
  const rendered = marked.parse(source, { async: false });
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed"],
  });
};
