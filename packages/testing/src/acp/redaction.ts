const secretAssignment = /\b(token|secret|password|api[_-]?key)=\S+/giu;

/** Keeps compatibility recordings safe to commit and display in test output. */
export const redactAcpRecording = (value: string): string =>
  value.replace(secretAssignment, "$1=<redacted>").replace(/\/Users\/[^\s"']+/gu, "<path>");
