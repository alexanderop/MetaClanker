export const THREAD_TITLE_LIMIT = 72;

export const deriveThreadTitle = (
  prompt: string,
  attachments: ReadonlyArray<string> = [],
): string => {
  const normalized = prompt.trim().replaceAll(/\s+/gu, " ");
  const source =
    normalized.length > 0
      ? normalized
      : `Attachment: ${attachments[0]?.split("/").at(-1) ?? "New attachment"}`;
  if (source.length <= THREAD_TITLE_LIMIT) return source;
  return `${source.slice(0, THREAD_TITLE_LIMIT - 1).trimEnd()}…`;
};
