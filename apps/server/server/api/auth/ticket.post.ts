import { defineEventHandler } from "h3";

import { TicketResponse } from "@metaclanker/contracts/wire";

import { issueWebSocketTicket } from "../../utils/auth.js";
import { runApplication } from "../../utils/runtime.js";
import { encodeResponse } from "../../utils/http.js";

export default defineEventHandler(async () =>
  encodeResponse(TicketResponse, { ticket: await runApplication(issueWebSocketTicket) }),
);
