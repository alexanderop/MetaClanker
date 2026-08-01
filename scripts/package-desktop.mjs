import { execFile } from "node:child_process";
import { chmod, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { FuseV1Options, FuseVersion, flipFuses } from "@electron/fuses";
import { packager } from "@electron/packager";

const execFilePromise = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stagingRoot = join(repositoryRoot, ".packaging");
const desktopRoot = join(stagingRoot, "desktop-app");
const serverRoot = join(stagingRoot, "server-app");
const runtimeRoot = join(stagingRoot, "node-runtime");
const artifactsRoot = join(repositoryRoot, "artifacts");
const platform = process.platform;
const arch = process.arch;

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await mkdir(desktopRoot, { recursive: true });
await execFilePromise("pnpm", ["--filter", "@metaclanker/server", "deploy", "--prod", serverRoot], {
  cwd: repositoryRoot,
});
await cp(join(repositoryRoot, "apps/server/.output"), join(serverRoot, ".output"), {
  recursive: true,
});
await copyFile(process.execPath, join(runtimeRoot, "node"));
await chmod(join(runtimeRoot, "node"), 0o755);
await cp(join(repositoryRoot, "apps/desktop/dist"), join(desktopRoot, "dist"), { recursive: true });
await writeFile(
  join(desktopRoot, "package.json"),
  JSON.stringify({
    name: "metaclanker-desktop",
    version: "0.1.0",
    type: "module",
    main: "dist/main.js",
  }),
);

const packaged = await packager({
  arch,
  asar: true,
  dir: desktopRoot,
  electronVersion: "43.2.0",
  extendInfo: {
    NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    NSLocalNetworkUsageDescription:
      "MetaClanker connects only to the private agent server running on this Mac.",
  },
  extraResource: [serverRoot, runtimeRoot],
  name: "MetaClanker",
  out: artifactsRoot,
  overwrite: true,
  platform,
  prune: false,
});
const packagePath = packaged[0];
if (packagePath === undefined) throw new Error("Electron packager produced no artifact");

const fuseTarget =
  platform === "darwin"
    ? join(packagePath, "MetaClanker.app")
    : join(packagePath, platform === "win32" ? "MetaClanker.exe" : "MetaClanker");
await flipFuses(fuseTarget, {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: platform === "darwin" && arch === "arm64",
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableCookieEncryption]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  [FuseV1Options.OnlyLoadAppFromAsar]: true,
  [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  [FuseV1Options.WasmTrapHandlers]: true,
});

process.stdout.write(`${fuseTarget}\n`);
