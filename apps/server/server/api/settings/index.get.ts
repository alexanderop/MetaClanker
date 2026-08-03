import { getSettings } from "@metaclanker/application/workspace";
import { UserSettings } from "@metaclanker/contracts/wire";

import { defineApiHandler, encodeResponse } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(() =>
  runApplication(getSettings()).then((settings) => encodeResponse(UserSettings, settings)),
);
