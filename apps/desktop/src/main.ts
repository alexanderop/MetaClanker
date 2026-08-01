import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 30_000;
const SHUTDOWN_GRACE_MS = 3_000;

let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverOrigin: string | null = null;
let quitting = false;
const restartTimes: number[] = [];
const smokeLog = (message: string): void => {
  if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
    process.stdout.write(`METACLANKER_SMOKE ${message}\n`);
  }
};

const randomToken = (): string => randomBytes(32).toString("base64url");

const reservePort = (): Promise<number> =>
  new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (address === null || typeof address === "string") {
        socket.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      const port = address.port;
      socket.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });

const waitForReadiness = async (origin: string, readinessToken: string): Promise<void> => {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    const ready = await fetch(`${origin}/api/health`, {
      headers: { "x-metaclanker-readiness": readinessToken },
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error("MetaClanker server did not become ready in time");
};

const serverEntry = (): string =>
  app.isPackaged
    ? resolve(process.resourcesPath, "server-app/.output/server/index.mjs")
    : resolve(app.getAppPath(), "../server/.output/server/index.mjs");

const serverRuntime = (): string =>
  app.isPackaged ? resolve(process.resourcesPath, "node-runtime/node") : process.execPath;

const serverWorkingDirectory = (): string =>
  app.isPackaged
    ? resolve(process.resourcesPath, "server-app")
    : resolve(app.getAppPath(), "../server");

const startServer = async (): Promise<string> => {
  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}`;
  const readinessToken = randomToken();
  const child = spawn(serverRuntime(), [serverEntry()], {
    cwd: serverWorkingDirectory(),
    env: {
      ...process.env,
      ...(app.isPackaged ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
      HOST: "127.0.0.1",
      PORT: String(port),
      METACLANKER_DATA_DIR: app.getPath("userData"),
      METACLANKER_READINESS_TOKEN: readinessToken,
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server = child;
  smokeLog(`server-pid ${String(child.pid)}`);
  child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.once("exit", () => {
    if (server === child) server = null;
    if (quitting) return;
    const now = Date.now();
    restartTimes.push(now);
    while ((restartTimes[0] ?? now) < now - RESTART_WINDOW_MS) restartTimes.shift();
    if (restartTimes.length > MAX_RESTARTS) {
      void dialog.showErrorBox(
        "MetaClanker server stopped",
        "The local server exited repeatedly. Restart MetaClanker after checking the diagnostics.",
      );
      return;
    }
    void restartServerAndReload();
  });
  await waitForReadiness(origin, readinessToken);
  smokeLog("server-ready");
  serverOrigin = origin;
  return origin;
};

const stopServer = async (): Promise<void> => {
  const child = server;
  if (child === null || child.exitCode !== null) return;
  const exited = new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
  child.kill("SIGTERM");
  const timeout = new Promise<"timeout">((resolveTimeout) => {
    setTimeout(() => resolveTimeout("timeout"), SHUTDOWN_GRACE_MS);
  });
  if ((await Promise.race([exited, timeout])) === "timeout") {
    child.kill("SIGKILL");
    await exited;
  }
};

const validSender = (senderUrl: string): boolean =>
  serverOrigin !== null && new URL(senderUrl).origin === serverOrigin;

const installPrivilegedHandlers = (): void => {
  ipcMain.handle("desktop:select-project-directory", async (event) => {
    const sender = event.senderFrame;
    if (sender === null || !validSender(sender.url)) throw new Error("Untrusted renderer sender");
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
};

const createWindow = async (origin: string): Promise<BrowserWindow> => {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#10120f",
    title: "MetaClanker",
    show: false,
    webPreferences: {
      preload: resolve(app.getAppPath(), "dist/preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on("did-fail-load", (_event, code, description) => {
    smokeLog(`renderer-failed ${String(code)} ${description}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    smokeLog(`renderer-gone ${details.reason}`);
  });
  window.once("ready-to-show", () => window.show());
  if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
    const response = await session.defaultSession.fetch(origin);
    smokeLog(`session-fetch ${String(response.status)}`);
  }
  smokeLog("renderer-loading");
  await window.loadURL(origin);
  smokeLog("renderer-loaded");
  if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
    const bridgeReady = await window.webContents
      .executeJavaScript("typeof window.metaClankerDesktop?.selectProjectDirectory === 'function'")
      .then((value: unknown) => value === true);
    if (bridgeReady !== true) throw new Error("Electron preload bridge did not initialize");
    smokeLog("preload-ready");
  }
  return window;
};

const restartServerAndReload = async (): Promise<void> => {
  const origin = await startServer();
  await mainWindow?.loadURL(origin);
};

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      await session.defaultSession.setProxy({ mode: "direct" });
      installPrivilegedHandlers();
      const origin = await startServer();
      mainWindow = await createWindow(origin);
      session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
        callback(false);
      });
      session.defaultSession.setPermissionCheckHandler(() => false);
      if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
        process.stdout.write("METACLANKER_PACKAGE_READY\n");
        smokeLog("quit-requested");
        app.quit();
      }
    })
    .catch((error: unknown) => {
      dialog.showErrorBox(
        "MetaClanker failed to start",
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  smokeLog("shutdown-started");
  void stopServer().finally(() => app.exit(0));
});
