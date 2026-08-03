import { defineEventHandler } from "h3";

import { ProviderReadinessResponse } from "@metaclanker/contracts/wire";

import { encodeResponse } from "../../utils/http.js";
import { runAgentCommand } from "../../utils/runtime.js";

export default defineEventHandler(async () =>
  encodeResponse(
    ProviderReadinessResponse,
    await runAgentCommand((commands) => commands.providerReadiness()),
  ),
);
