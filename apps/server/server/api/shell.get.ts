import { shellSnapshot } from "@metaclanker/application/workspace";

import { defineApiHandler } from "../utils/http.js";
import { runApplication } from "../utils/runtime.js";

export default defineApiHandler(() => runApplication(shellSnapshot()));
