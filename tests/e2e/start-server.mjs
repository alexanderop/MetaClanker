import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dataDirectory = resolve(".e2e-data");
await rm(dataDirectory, { recursive: true, force: true });
await mkdir(dataDirectory, { recursive: true });

const child = spawn(process.execPath, [resolve("apps/server/.output/server/index.mjs")], {
  cwd: resolve("apps/server"),
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    NODE_ENV: "test",
    PORT: "4401",
    METACLANKER_DATA_DIR: dataDirectory,
    NITRO_METACLANKER_DATA_DIRECTORY: dataDirectory,
    METACLANKER_TEST_ACP_ENTRY: resolve("packages/testing/dist/acp/fake-agent.js"),
    METACLANKER_PROJECT_BROWSER_ROOTS: tmpdir(),
  },
  shell: false,
  stdio: "inherit",
});

const forward = (signal) => child.kill(signal);
process.once("SIGINT", () => forward("SIGINT"));
process.once("SIGTERM", () => forward("SIGTERM"));
child.once("exit", (code) => process.exit(code ?? 1));
