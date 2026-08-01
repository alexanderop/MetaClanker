import { defineEventHandler } from "h3";

import { issueWebSocketTicket } from "../../utils/auth.js";

export default defineEventHandler(() => ({ ticket: issueWebSocketTicket() }));
