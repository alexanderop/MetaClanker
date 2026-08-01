import { Effect } from "effect";
import { makeAcpSessions } from "/Users/alexanderopalic/Projects/active/MetaClanker/packages/acp-client/dist/session.js";

const fake =
  "/Users/alexanderopalic/Projects/active/MetaClanker/packages/testing/dist/acp/fake-agent.js";
const delay = Number(process.argv[2] ?? "0");

const sessions = makeAcpSessions({
  codex: { command: process.execPath, args: [fake] },
  claude: { command: process.execPath, args: [fake] },
});
const handle = await Effect.runPromise(
  sessions.open({
    provider: "codex",
    cwd: process.cwd(),
    projectId: "p",
    threadId: "t",
    providerSessionId: null,
    model: null,
    effort: null,
    permissionMode: null,
  }),
);
const events = [];
const result = await Effect.runPromise(
  handle.prompt({ turnId: "turn", text: "Inspect it", attachments: [] }, (event) =>
    Effect.promise(async () => {
      await new Promise((r) => setTimeout(r, delay));
      events.push(event.type);
      if (event.type === "permission") {
        setTimeout(() => {
          void Effect.runPromise(handle.respondInteraction(event.interaction.id, "allow"));
        }, delay);
      }
    }),
  ),
);
await Effect.runPromise(handle.close);
console.log(`delay=${delay}ms stop=${result.stopReason} events=${JSON.stringify(events)}`);
