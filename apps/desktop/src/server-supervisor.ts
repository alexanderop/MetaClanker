export const MAX_RESTARTS = 3;
export const RESTART_WINDOW_MS = 30_000;

export interface ServerSupervisorPorts {
  /** Spawns the server and resolves with its origin once it is ready. */
  readonly startServer: () => Promise<string>;
  readonly reload: (origin: string) => Promise<void>;
  /** Shown once the restart budget is exhausted. */
  readonly reportRepeatedFailure: () => void;
  readonly now: () => number;
  readonly quitting: () => boolean;
  readonly log: (message: string) => void;
}

export interface ServerSupervisor {
  readonly restart: () => Promise<void>;
}

/**
 * Bounds server restarts by attempt rather than by child exit. A start that rejects
 * before the child is spawned produces no exit event, so counting exits let a
 * persistently failing restart escape the budget entirely — and, because the caller
 * discarded the rejection, take the main process down with it.
 */
export const createServerSupervisor = (ports: ServerSupervisorPorts): ServerSupervisor => {
  const attempts: number[] = [];
  let inFlight: Promise<void> | null = null;

  const withinBudget = (): boolean => {
    const now = ports.now();
    attempts.push(now);
    while ((attempts[0] ?? now) < now - RESTART_WINDOW_MS) attempts.shift();
    return attempts.length <= MAX_RESTARTS;
  };

  const run = async (): Promise<void> => {
    while (!ports.quitting()) {
      if (!withinBudget()) {
        ports.reportRepeatedFailure();
        return;
      }
      try {
        await ports.reload(await ports.startServer());
        return;
      } catch (cause) {
        ports.log(
          `server-restart-failed ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    }
  };

  return {
    restart: () => {
      inFlight ??= run().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
  };
};
