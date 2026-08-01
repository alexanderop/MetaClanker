import { CommandId, ProjectId } from "@metaclanker/contracts/ids";

export const projectFixture = (
  overrides: Partial<{ id: string; name: string; path: string }> = {},
) => ({
  id: ProjectId.make(overrides.id ?? "project:test"),
  commandId: CommandId.make("command:create-project"),
  name: overrides.name ?? "Test project",
  path: overrides.path ?? "/tmp/metaclanker-project",
  gitBranch: null,
  gitStatus: "unavailable" as const,
  createdAt: "2026-08-01T00:00:00.000Z",
});
