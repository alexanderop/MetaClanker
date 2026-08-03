import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { makeAcpSessions } from "./dist/session.js";

const fake = fileURLToPath(new URL("../testing/dist/acp/fake-agent.js", import.meta.url));
const delay = Number(process.argv[2] ?? "0");

const sessions = makeAcpSessions({
  codex: { command: process.execPath, args: [fake] },
  claude: { command: process.execPath, args: [fake] },
});
const events = [];
const result = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* sessions.open({
        provider: "codex",
        cwd: process.cwd(),
        projectId: "p",
        threadId: "t",
        providerSessionId: null,
        model: null,
        effort: null,
        permissionMode: null,
      });
      yield* handle.events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            yield* Effect.sleep(delay);
            events.push(event.type);
            if (event.type === "permission") {
              yield* handle.respondInteraction(event.interaction.id, "allow");
            }
          }),
        ),
        Effect.forkScoped,
      );
      const outcome = yield* handle.prompt({
        turnId: "turn",
        text: "Inspect it",
        attachments: [],
      });
      yield* handle.drainAcceptedEvents;
      return outcome;
    }),
  ),
);
console.log(`delay=${delay}ms stop=${result.stopReason} events=${JSON.stringify(events)}`);
