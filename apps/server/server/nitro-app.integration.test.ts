import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const serverRoot = join(repositoryRoot, "apps/server");

const reservePort = async (): Promise<number> =>
  await new Promise((resolvePort, reject) => {
    const socket = createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address();
      if (address === null || typeof address === "string") {
        socket.close();
        reject(new Error("Could not reserve a loopback port"));
        return;
      }
      socket.close((error) => (error === undefined ? resolvePort(address.port) : reject(error)));
    });
  });

const waitForServer = (child: ChildProcess): Promise<void> =>
  new Promise((resolveReady, rejectReady) => {
    let output = "";
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Nitro did not start:\n${output}`));
    }, 20_000);
    const complete = (result: () => void): void => {
      clearTimeout(timeout);
      result();
    };
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      output += chunk;
      if (output.includes("Listening on http://127.0.0.1:")) complete(resolveReady);
    });
    child.stderr?.on("data", (chunk: string) => {
      output += chunk;
    });
    child.once("error", (cause) => complete(() => rejectReady(cause)));
    child.once("exit", (code) => {
      complete(() =>
        rejectReady(new Error(`Nitro exited before listening (${String(code)}):\n${output}`)),
      );
    });
  });

interface SocketObserver {
  readonly socket: WebSocket;
  readonly nextMessage: () => Promise<unknown>;
  readonly closeCode: Promise<number>;
}

const observeSocket = async (path: string): Promise<SocketObserver> =>
  await new Promise((resolveObserver, rejectObserver) => {
    const socket = new WebSocket(path);
    const messages: unknown[] = [];
    let resolveMessage: ((message: unknown) => void) | undefined;
    let rejectMessage: ((cause: unknown) => void) | undefined;
    const nextMessage = (): Promise<unknown> => {
      const message = messages.shift();
      if (message !== undefined) return Promise.resolve(message);
      return new Promise((resolveNext, rejectNext) => {
        resolveMessage = resolveNext;
        rejectMessage = rejectNext;
      });
    };
    const closeCode = new Promise<number>((resolveClose) => {
      socket.addEventListener("close", (event) => {
        rejectMessage?.(
          new Error(`Socket closed before an expected message (${String(event.code)})`),
        );
        resolveClose(event.code);
      });
    });
    socket.addEventListener("message", (event) => {
      const message: unknown = JSON.parse(String(event.data));
      if (resolveMessage === undefined) messages.push(message);
      else {
        resolveMessage(message);
        resolveMessage = undefined;
        rejectMessage = undefined;
      }
    });
    socket.addEventListener("open", () => resolveObserver({ socket, nextMessage, closeCode }));
    socket.addEventListener("error", () =>
      rejectObserver(new Error(`WebSocket connection failed: ${path}`)),
    );
  });

const issueWebSocketTicket = async (origin: string, sessionCookie: string): Promise<string> => {
  const response = await fetch(`${origin}/api/auth/ticket`, {
    method: "POST",
    headers: { cookie: sessionCookie },
  });
  expect(response.status).toBe(200);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("ticket" in body) ||
    typeof body.ticket !== "string"
  ) {
    throw new Error("WebSocket ticket response was invalid");
  }
  return body.ticket;
};

describe("the built Nitro application", () => {
  let dataDirectory = "";
  let server: ChildProcess | undefined;
  let origin = "";
  let projectDirectory = "";
  let sessionCookie = "";

  beforeAll(async () => {
    await run("pnpm", ["--filter", "@metaclanker/web", "build"], { cwd: repositoryRoot });
    await run("pnpm", ["--filter", "@metaclanker/server", "build"], { cwd: repositoryRoot });
    dataDirectory = await mkdtemp(join(tmpdir(), "metaclanker-nitro-app-"));
    projectDirectory = await mkdtemp(join(tmpdir(), "metaclanker-nitro-project-"));
    const port = await reservePort();
    origin = `http://127.0.0.1:${String(port)}`;
    server = spawn(process.execPath, [".output/server/index.mjs"], {
      cwd: serverRoot,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        METACLANKER_DATA_DIR: dataDirectory,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForServer(server);

    const localAuthentication = await fetch(`${origin}/api/auth/local`, { method: "POST" });
    expect(localAuthentication.status).toBe(200);
    const setCookie = localAuthentication.headers.getSetCookie()[0];
    if (setCookie === undefined)
      throw new Error("Local authentication did not issue a session cookie");
    sessionCookie = setCookie.split(";", 1)[0] ?? "";

    const shell = await fetch(`${origin}/api/shell`, { headers: { cookie: sessionCookie } });
    expect(shell.status).toBe(200);
    await expect(access(join(dataDirectory, "metaclanker.sqlite"))).resolves.toBeUndefined();
  });

  afterAll(async () => {
    if (server !== undefined && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit");
    }
    await Promise.all(
      [dataDirectory, projectDirectory]
        .filter((directory) => directory !== "")
        .map(async (directory) => await rm(directory, { recursive: true, force: true })),
    );
  });

  it("serves immutable hashed assets while keeping the app shell private to the server bundle", async () => {
    const shell = await fetch(`${origin}/an-app-route`);
    expect(shell.status).toBe(200);
    const document = await shell.text();
    const asset = /(?:src|href)="(\/assets\/[^"]+)"/u.exec(document)?.[1];
    expect(asset).toBeDefined();

    const response = await fetch(`${origin}${asset ?? ""}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=31536000");
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("returns structured API errors instead of the SPA shell", async () => {
    const response = await fetch(`${origin}/api/a-typo`, {
      headers: { cookie: sessionCookie },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: { code: "not-found", message: "API endpoint not found" },
    });
  });

  it("rejects an empty first prompt as a safe client error", async () => {
    const response = await fetch(`${origin}/api/threads/start`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "command:empty",
        projectId: "project:empty",
        provider: "codex",
        prompt: "",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid-request", message: "A prompt or attachment is required" },
    });
  });

  it("owns conflict and not-found failures at the HTTP boundary", async () => {
    const [mismatch, inactiveTurn, missingThread, missingCheckpoint] = await Promise.all([
      fetch(`${origin}/api/threads/thread:path/prompts`, {
        method: "POST",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({
          commandId: "command:mismatch",
          threadId: "thread:body",
          prompt: "This must not dispatch",
        }),
      }),
      fetch(`${origin}/api/threads/thread:inactive/cancel`, {
        method: "POST",
        headers: { cookie: sessionCookie },
      }),
      fetch(`${origin}/api/threads/thread:missing`, {
        method: "PATCH",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({ title: "No thread" }),
      }),
      fetch(`${origin}/api/threads/thread:missing/restore-preview`, {
        method: "POST",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({ checkpointId: "checkpoint:missing" }),
      }),
    ]);

    expect(mismatch.status).toBe(409);
    await expect(mismatch.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    expect(inactiveTurn.status).toBe(409);
    await expect(inactiveTurn.json()).resolves.toMatchObject({ error: { code: "conflict" } });
    const missingThreadBody: unknown = await missingThread.json();
    expect(missingThread.status, JSON.stringify(missingThreadBody)).toBe(404);
    expect(missingThreadBody).toMatchObject({ error: { code: "not-found" } });
    expect(missingCheckpoint.status).toBe(404);
    await expect(missingCheckpoint.json()).resolves.toMatchObject({ error: { code: "not-found" } });
  });

  it("authenticates real WebSocket upgrades and delivers replay plus live events once", async () => {
    const ticket = await issueWebSocketTicket(origin, sessionCookie);
    const observer = await observeSocket(
      `${origin.replace("http", "ws")}/api/shell/events?ticket=${encodeURIComponent(ticket)}&afterSequence=0`,
    );
    await expect(observer.nextMessage()).resolves.toEqual({ type: "synchronized", sequence: 0 });

    const createProject = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { cookie: sessionCookie, "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "command:websocket-project",
        path: projectDirectory,
        name: "WebSocket project",
      }),
    });
    expect(createProject.status).toBe(200);
    const project: unknown = await createProject.json();
    await expect(observer.nextMessage()).resolves.toMatchObject({
      type: "project-upserted",
      sequence: 1,
      project,
    });

    observer.socket.close();
    await expect(observer.closeCode).resolves.toBe(1005);
  });

  it("rejects reused tickets and invalid replay cursors on the transport", async () => {
    const ticket = await issueWebSocketTicket(origin, sessionCookie);
    const accepted = await observeSocket(
      `${origin.replace("http", "ws")}/api/shell/events?ticket=${encodeURIComponent(ticket)}&afterSequence=1`,
    );
    await expect(accepted.nextMessage()).resolves.toEqual({ type: "synchronized", sequence: 1 });
    accepted.socket.close();
    await accepted.closeCode;

    const reused = await observeSocket(
      `${origin.replace("http", "ws")}/api/shell/events?ticket=${encodeURIComponent(ticket)}&afterSequence=1`,
    );
    await expect(reused.closeCode).resolves.toBe(4401);

    const invalidCursorTicket = await issueWebSocketTicket(origin, sessionCookie);
    const invalidCursor = await observeSocket(
      `${origin.replace("http", "ws")}/api/shell/events?ticket=${encodeURIComponent(invalidCursorTicket)}&afterSequence=-1`,
    );
    await expect(invalidCursor.closeCode).resolves.toBe(4400);
  });
});
