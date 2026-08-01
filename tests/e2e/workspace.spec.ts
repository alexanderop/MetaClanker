import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, test as base, type Page } from "@playwright/test";

const execFilePromise = promisify(execFile);
const createProject = async (): Promise<string> => {
  const projectPath = await mkdtemp(join(tmpdir(), "metaclanker-e2e-project-"));
  await writeFile(join(projectPath, "README.md"), "# E2E project\n");
  await execFilePromise("git", ["init", "--initial-branch=main"], { cwd: projectPath });
  await execFilePromise("git", ["add", "README.md"], { cwd: projectPath });
  await execFilePromise(
    "git",
    [
      "-c",
      "user.name=MetaClanker Test",
      "-c",
      "user.email=test@metaclanker.local",
      "commit",
      "-m",
      "seed",
    ],
    { cwd: projectPath },
  );
  return projectPath;
};

const test = base.extend<{ projectPath: string }>({
  projectPath: async ({ browserName }, use) => {
    void browserName;
    const projectPath = await createProject();
    await use(projectPath);
    await rm(projectPath, { recursive: true, force: true });
  },
});

const capturePageErrors = (page: Page): string[] => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

const addProject = async (page: Page, projectPath: string, name: string): Promise<void> => {
  await page.getByRole("button", { name: "Add project" }).click();
  const dialog = page.getByRole("dialog", { name: "Open a server-side project" });
  await dialog.getByLabel("Absolute project path").fill(projectPath);
  await dialog.getByLabel("Display name").fill(name);
  await dialog.getByRole("button", { name: "Add project" }).click();
  await expect(page.getByText(name)).toBeVisible();
};

test("a user streams a Codex-like turn, approves work, and opens review", async ({
  page,
  projectPath,
}) => {
  const pageErrors = capturePageErrors(page);

  await page.goto("/");
  await addProject(page, projectPath, "E2E workspace");
  await page.getByRole("button", { name: "New thread" }).click();
  await page.getByRole("button", { name: "Codex", exact: true }).click();
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();

  await page.getByLabel("Ask the agent to build, investigate, or explain…").fill("Inspect it");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Write implementation file" })).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await expect(page.getByText(/Permission granted.*deterministic task is complete/u)).toBeVisible();
  await expect(page.getByText("Agent turn completed")).toBeVisible();

  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("heading", { name: "Review changes" })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a restored application reloads a durable thread and interrupts its active turn", async ({
  page,
  projectPath,
}) => {
  const pageErrors = capturePageErrors(page);

  await page.goto("/");
  await addProject(page, projectPath, "Recovery workspace");
  await page
    .getByRole("region", { name: "Recovery workspace project" })
    .getByRole("button", { name: "New thread" })
    .click();
  await page.getByRole("button", { name: "Claude", exact: true }).click();

  await page.getByLabel("Ask the agent to build, investigate, or explain…").fill("Keep working");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "Write implementation file" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "New conversation" })).toBeVisible();
  await expect(page.getByText("Keep working", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Write implementation file" })).toBeVisible();
  await page.getByRole("button", { name: "Stop turn" }).click();
  await expect(page.getByRole("status", { name: "Thread status: cancelled" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
