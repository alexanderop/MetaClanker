import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const platform = process.platform;
const arch = process.arch;
const packageRoot = resolve(`artifacts/MetaClanker-${platform}-${arch}`);
const executable =
  platform === "darwin"
    ? join(packageRoot, "MetaClanker.app/Contents/MacOS/MetaClanker")
    : join(packageRoot, platform === "win32" ? "MetaClanker.exe" : "MetaClanker");
const profile = await mkdtemp(join(tmpdir(), "metaclanker-package-smoke-"));
const smokeProject = await mkdtemp(join(tmpdir(), "metaclanker-picker-project-"));

const runPackaged = async (phase) => {
  const child = spawn(executable, [`--user-data-dir=${profile}`], {
    env: {
      ...process.env,
      METACLANKER_PACKAGE_SMOKE: "1",
      METACLANKER_PACKAGE_SMOKE_PHASE: phase,
      METACLANKER_PACKAGE_SMOKE_PROJECT: smokeProject,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
    force.unref();
  }, 30_000);
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code));
  });
  clearTimeout(timeout);
  return { exitCode, output };
};

const setup = await runPackaged("setup");
const verification = await runPackaged("verify-sidebar");
const output = `${setup.output}\n${verification.output}`;
const exitCode = setup.exitCode === 0 ? verification.exitCode : setup.exitCode;

await rm(profile, { recursive: true, force: true });
await rm(smokeProject, { recursive: true, force: true });

const serverPids = [...output.matchAll(/METACLANKER_SMOKE server-pid (\d+)/gu)].map((match) =>
  Number(match[1]),
);
const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
for (const serverPid of serverPids) {
  const deadline = Date.now() + 2_000;
  while (processIsAlive(serverPid) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  if (processIsAlive(serverPid)) {
    process.kill(serverPid, "SIGKILL");
    throw new Error(
      `Packaged application left server process ${String(serverPid)} running:\n${output}`,
    );
  }
}

if (
  exitCode !== 0 ||
  !output.includes("METACLANKER_PACKAGE_READY") ||
  !output.includes("METACLANKER_SMOKE native-picker-draft") ||
  !output.includes("METACLANKER_SMOKE conversation-draft-saved") ||
  !output.includes("METACLANKER_SMOKE conversation-draft-restored") ||
  !output.includes("METACLANKER_SMOKE sidebar-collapsed-saved") ||
  !output.includes("METACLANKER_SMOKE sidebar-collapsed-restored") ||
  serverPids.length !== 2
) {
  throw new Error(`Packaged application smoke failed (${String(exitCode)}):\n${output}`);
}
process.stdout.write(
  "Packaged Electron readiness, native picker-to-draft, draft persistence, sidebar persistence, SQLite, renderer load, and shutdown passed.\n",
);
