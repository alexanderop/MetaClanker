import { shellSnapshot } from "@metaclanker/application/workspace";
import { ShellSnapshot } from "@metaclanker/contracts/wire";

import { defineApiHandler, encodeResponse } from "../utils/http.js";
import { runApplication } from "../utils/runtime.js";

export default defineApiHandler(() =>
  runApplication(shellSnapshot()).then((snapshot) => encodeResponse(ShellSnapshot, snapshot)),
);
