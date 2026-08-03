import { describe, expect, it } from "vitest";

import {
  createServerSupervisor,
  MAX_RESTARTS,
  RESTART_WINDOW_MS,
  type ServerSupervisorPorts,
} from "./server-supervisor.js";

interface Recorder {
  readonly ports: ServerSupervisorPorts;
  readonly starts: () => number;
  readonly reloaded: () => ReadonlyArray<string>;
  readonly repeatedFailures: () => number;
  readonly logs: () => ReadonlyArray<string>;
}

const recorder = (
  startServer: (attempt: number) => Promise<string>,
  overrides: Partial<ServerSupervisorPorts> = {},
): Recorder => {
  let attempt = 0;
  let repeatedFailures = 0;
  const reloaded: string[] = [];
  const logs: string[] = [];
  let clock = 0;
  return {
    starts: () => attempt,
    reloaded: () => reloaded,
    repeatedFailures: () => repeatedFailures,
    logs: () => logs,
    ports: {
      startServer: () => {
        attempt += 1;
        return startServer(attempt);
      },
      reload: (origin) => {
        reloaded.push(origin);
        return Promise.resolve();
      },
      reportRepeatedFailure: () => {
        repeatedFailures += 1;
      },
      now: () => {
        clock += 1;
        return clock;
      },
      quitting: () => false,
      log: (message) => logs.push(message),
      ...overrides,
    },
  };
};

describe("desktop server supervisor", () => {
  it("reports repeated failure instead of rejecting when the server never starts", async () => {
    const observed = recorder(() => Promise.reject(new Error("port unavailable")));
    const supervisor = createServerSupervisor(observed.ports);

    await expect(supervisor.restart()).resolves.toBeUndefined();

    expect(observed.starts()).toBe(MAX_RESTARTS);
    expect(observed.repeatedFailures()).toBe(1);
    expect(observed.reloaded()).toEqual([]);
    expect(observed.logs().every((entry) => entry.startsWith("server-restart-failed"))).toBe(true);
  });

  it("reloads the window once a retried start succeeds", async () => {
    const observed = recorder((attempt) =>
      attempt < MAX_RESTARTS
        ? Promise.reject(new Error("not ready"))
        : Promise.resolve("http://127.0.0.1:4321"),
    );
    const supervisor = createServerSupervisor(observed.ports);

    await supervisor.restart();

    expect(observed.reloaded()).toEqual(["http://127.0.0.1:4321"]);
    expect(observed.repeatedFailures()).toBe(0);
  });

  it("forgets attempts that fall outside the restart window", async () => {
    const spacedFailures = MAX_RESTARTS + 3;
    let clock = 0;
    const observed = recorder(
      (attempt) =>
        attempt > spacedFailures
          ? Promise.resolve("http://127.0.0.1:4321")
          : Promise.reject(new Error("crashed")),
      {
        // Every attempt looks like it happened a full window after the previous one.
        now: () => {
          clock += RESTART_WINDOW_MS + 1;
          return clock;
        },
      },
    );
    const supervisor = createServerSupervisor(observed.ports);

    await supervisor.restart();

    expect(observed.starts()).toBe(spacedFailures + 1);
    expect(observed.repeatedFailures()).toBe(0);
    expect(observed.reloaded()).toEqual(["http://127.0.0.1:4321"]);
  });

  it("does not start a second restart while one is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const observed = recorder(() => gate.then(() => "http://127.0.0.1:4321"));
    const supervisor = createServerSupervisor(observed.ports);

    const first = supervisor.restart();
    const second = supervisor.restart();
    release();
    await Promise.all([first, second]);

    expect(observed.starts()).toBe(1);
    expect(observed.reloaded()).toEqual(["http://127.0.0.1:4321"]);
  });
});
