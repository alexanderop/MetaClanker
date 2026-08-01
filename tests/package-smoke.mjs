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

const child = spawn(executable, [`--user-data-dir=${profile}`], {
  env: {
    ...process.env,
    METACLANKER_PACKAGE_SMOKE: "1",
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
await rm(profile, { recursive: true, force: true });
await rm(smokeProject, { recursive: true, force: true });

const serverPidMatch = /METACLANKER_SMOKE server-pid (\d+)/u.exec(output);
const serverPid = serverPidMatch === null ? null : Number(serverPidMatch[1]);
const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
if (serverPid !== null) {
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
  serverPid === null
) {
  throw new Error(`Packaged application smoke failed (${String(exitCode)}):\n${output}`);
}
process.stdout.write(
  "Packaged Electron readiness, native picker-to-draft, SQLite, renderer load, and shutdown passed.\n",
);
