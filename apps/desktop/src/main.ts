import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";

const MAX_RESTARTS = 3;
const RESTART_WINDOW_MS = 30_000;
const SHUTDOWN_GRACE_MS = 3_000;
const MAX_CONVERSATION_DRAFT_BYTES = 2 * 1024 * 1024;

let server: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;
let serverOrigin: string | null = null;
let quitting = false;
const restartTimes: number[] = [];
let conversationDraftWrite = Promise.resolve();
const smokeLog = (message: string): void => {
  if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
    process.stdout.write(`METACLANKER_SMOKE ${message}\n`);
  }
};

const readSidebarCollapsed = async (): Promise<boolean> => {
  try {
    const value = JSON.parse(
      await readFile(join(app.getPath("userData"), "presentation-state.json"), "utf8"),
    ) as unknown;
    return (
      typeof value === "object" &&
      value !== null &&
      "sidebarCollapsed" in value &&
      value.sidebarCollapsed === true
    );
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT" || cause instanceof SyntaxError) {
      return false;
    }
    throw cause;
  }
};

const writeSidebarCollapsed = async (collapsed: boolean): Promise<void> => {
  await writeFile(
    join(app.getPath("userData"), "presentation-state.json"),
    JSON.stringify({ sidebarCollapsed: collapsed }),
    { encoding: "utf8", mode: 0o600 },
  );
};

const validateConversationDrafts = (serialized: string): void => {
  if (Buffer.byteLength(serialized, "utf8") > MAX_CONVERSATION_DRAFT_BYTES) {
    throw new Error("Conversation draft state is too large");
  }
  const value = JSON.parse(serialized) as unknown;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid conversation draft state");
  }
};

const readConversationDrafts = async (): Promise<string | null> => {
  try {
    const serialized = await readFile(
      join(app.getPath("userData"), "conversation-drafts.json"),
      "utf8",
    );
    validateConversationDrafts(serialized);
    return serialized;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT" || cause instanceof SyntaxError) {
      return null;
    }
    throw cause;
  }
};

const enqueueConversationDraftWrite = (serialized: string): Promise<void> => {
  validateConversationDrafts(serialized);
  conversationDraftWrite = conversationDraftWrite
    .catch(() => undefined)
    .then(() =>
      writeFile(join(app.getPath("userData"), "conversation-drafts.json"), serialized, {
        encoding: "utf8",
        mode: 0o600,
      }),
    );
  return conversationDraftWrite;
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
      NITRO_METACLANKER_DATA_DIRECTORY: app.getPath("userData"),
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
    if (process.env["METACLANKER_PACKAGE_SMOKE"] === "1") {
      return process.env["METACLANKER_PACKAGE_SMOKE_PROJECT"] ?? null;
    }
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:set-sidebar-collapsed", async (event, collapsed: unknown) => {
    const sender = event.senderFrame;
    if (sender === null || !validSender(sender.url)) throw new Error("Untrusted renderer sender");
    if (typeof collapsed !== "boolean") throw new Error("Invalid sidebar state");
    await writeSidebarCollapsed(collapsed);
  });
  ipcMain.handle("desktop:read-conversation-drafts", async (event) => {
    const sender = event.senderFrame;
    if (sender === null || !validSender(sender.url)) throw new Error("Untrusted renderer sender");
    return readConversationDrafts();
  });
  ipcMain.handle("desktop:set-conversation-drafts", async (event, serialized: unknown) => {
    const sender = event.senderFrame;
    if (sender === null || !validSender(sender.url)) throw new Error("Untrusted renderer sender");
    if (typeof serialized !== "string") throw new Error("Invalid conversation draft state");
    await enqueueConversationDraftWrite(serialized);
  });
};

const createWindow = async (origin: string): Promise<BrowserWindow> => {
  const sidebarCollapsed = await readSidebarCollapsed();
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
      additionalArguments: [`--metaclanker-sidebar-collapsed=${String(sidebarCollapsed)}`],
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
      .executeJavaScript(
        "typeof window.metaClankerDesktop?.selectProjectDirectory === 'function' && typeof window.metaClankerDesktop?.setSidebarCollapsed === 'function' && typeof window.metaClankerDesktop?.readConversationDrafts === 'function' && typeof window.metaClankerDesktop?.setConversationDrafts === 'function'",
      )
      .then((value: unknown) => value === true);
    if (bridgeReady !== true) throw new Error("Electron preload bridge did not initialize");
    smokeLog("preload-ready");
    const smokePhase = process.env["METACLANKER_PACKAGE_SMOKE_PHASE"] ?? "setup";
    if (smokePhase === "setup") {
      const smokeProject = process.env["METACLANKER_PACKAGE_SMOKE_PROJECT"];
      if (smokeProject === undefined) throw new Error("Packaged smoke project was not configured");
      const pickerReachedDraft: unknown = await window.webContents.executeJavaScript(`(async () => {
      const waitFor = (check) => new Promise((resolveWait, rejectWait) => {
        const immediate = check();
        if (immediate) {
          resolveWait(immediate);
          return;
        }
        const observer = new MutationObserver(() => {
          const result = check();
          if (!result) return;
          clearTimeout(timeout);
          observer.disconnect();
          resolveWait(result);
        });
        const timeout = setTimeout(() => {
          observer.disconnect();
          rejectWait(new Error("Timed out waiting for packaged picker journey"));
        }, 8000);
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      });
      const addButton = await waitFor(() => document.querySelector("button.folder-add-button"));
      addButton.click();
      const draftTextarea = await waitFor(() => location.pathname.startsWith("/new/") ? document.querySelector("textarea") : null);
      await new Promise(requestAnimationFrame);
      return document.activeElement === draftTextarea;
    })()`);
      if (pickerReachedDraft !== true)
        throw new Error("Native picker did not reach the focused draft");
      smokeLog("native-picker-draft");
      const draftSaved: unknown = await window.webContents.executeJavaScript(`(async () => {
        const textarea = document.querySelector('textarea[aria-label="Ask the agent to build, investigate, or explain…"]');
        const controlFor = (label) => Array.from(document.querySelectorAll('label')).find(
          (element) => element.querySelector('.sr-only')?.textContent?.trim() === label,
        )?.querySelector('input, select');
        const model = controlFor('Model');
        const effort = controlFor('Effort');
        const permissions = controlFor('Permissions');
        if (!(textarea instanceof HTMLTextAreaElement)) return false;
        if (!(model instanceof HTMLInputElement)) return false;
        if (!(effort instanceof HTMLSelectElement)) return false;
        if (!(permissions instanceof HTMLSelectElement)) return false;
        textarea.value = 'PACKAGED_DRAFT_RESTORED';
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        model.value = 'package-smoke-model';
        model.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
        effort.value = 'medium';
        effort.dispatchEvent(new Event('change', { bubbles: true }));
        permissions.value = 'read-only';
        permissions.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.focus();
        textarea.setSelectionRange(8, 8);
        textarea.dispatchEvent(new Event('select', { bubbles: true }));
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        const serialized = localStorage.getItem('metaclanker:conversation-drafts:v2');
        if (serialized === null) return false;
        await window.metaClankerDesktop?.setConversationDrafts?.(serialized);
        return serialized.includes('PACKAGED_DRAFT_RESTORED') && serialized.includes('package-smoke-model');
      })()`);
      if (draftSaved !== true) throw new Error("Conversation draft was not prepared for relaunch");
      smokeLog("conversation-draft-saved");
      const collapsed: unknown = await window.webContents.executeJavaScript(`(async () => {
        const collapse = document.querySelector('[aria-label="Collapse sidebar"]');
        if (!(collapse instanceof HTMLButtonElement)) return false;
        collapse.click();
        await window.metaClankerDesktop.setSidebarCollapsed(true);
        return document.querySelector('[aria-label="Expand sidebar"]') !== null;
      })()`);
      if (collapsed !== true) throw new Error("Sidebar did not collapse and persist");
      smokeLog("sidebar-collapsed-saved");
    } else if (smokePhase === "verify-sidebar") {
      const restored: unknown = await window.webContents.executeJavaScript(
        "document.querySelector('[aria-label=\"Expand sidebar\"]') !== null",
      );
      if (restored !== true) throw new Error("Sidebar collapsed state was not restored");
      smokeLog("sidebar-collapsed-restored");
      const draftRestored: unknown = await window.webContents.executeJavaScript(`(async () => {
        const waitFor = (check) => new Promise((resolveWait, rejectWait) => {
          const immediate = check();
          if (immediate) {
            resolveWait(immediate);
            return;
          }
          const observer = new MutationObserver(() => {
            const result = check();
            if (!result) return;
            clearTimeout(timeout);
            observer.disconnect();
            resolveWait(result);
          });
          const timeout = setTimeout(() => {
            observer.disconnect();
            rejectWait(new Error("Timed out waiting for packaged draft restoration"));
          }, 8000);
          observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        });
        const expand = document.querySelector('[aria-label="Expand sidebar"]');
        if (!(expand instanceof HTMLButtonElement)) return false;
        expand.click();
        const projectDraft = await waitFor(() => Array.from(document.querySelectorAll('button')).find(
          (button) => button.getAttribute('aria-label')?.startsWith('New chat in '),
        ));
        projectDraft.click();
        const textarea = await waitFor(() => location.pathname.startsWith('/new/')
          ? document.querySelector('textarea[aria-label="Ask the agent to build, investigate, or explain…"]')
          : null);
        const controlFor = (label) => Array.from(document.querySelectorAll('label')).find(
          (element) => element.querySelector('.sr-only')?.textContent?.trim() === label,
        )?.querySelector('input, select');
        const model = controlFor('Model');
        const effort = controlFor('Effort');
        const permissions = controlFor('Permissions');
        return textarea instanceof HTMLTextAreaElement
          && textarea.value === 'PACKAGED_DRAFT_RESTORED'
          && textarea.selectionStart === 8
          && textarea.selectionEnd === 8
          && document.activeElement === textarea
          && model instanceof HTMLInputElement
          && model.value === 'package-smoke-model'
          && effort instanceof HTMLSelectElement
          && effort.value === 'medium'
          && permissions instanceof HTMLSelectElement
          && permissions.value === 'read-only';
      })()`);
      if (draftRestored !== true) throw new Error("Conversation draft was not restored");
      smokeLog("conversation-draft-restored");
    } else {
      throw new Error("Unknown packaged smoke phase");
    }
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
  void Promise.all([stopServer(), conversationDraftWrite.catch(() => undefined)]).finally(() =>
    app.exit(0),
  );
});
