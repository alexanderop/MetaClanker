import { defineEventHandler } from "h3";

import { listProviderReadiness } from "../../utils/orchestrator.js";

export default defineEventHandler(() => listProviderReadiness());
