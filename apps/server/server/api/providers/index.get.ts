import { defineEventHandler } from "h3";

import { runAgentCommand } from "../../utils/runtime.js";

export default defineEventHandler(
  async () => await runAgentCommand((commands) => commands.providerReadiness()),
);
