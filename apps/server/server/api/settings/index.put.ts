import { saveSettings } from "@metaclanker/application/workspace";
import { UserSettings } from "@metaclanker/contracts/wire";

import { decodeBody, defineApiHandler, encodeResponse } from "../../utils/http.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const input = await decodeBody(event, UserSettings);
  return runApplication(saveSettings(input)).then((settings) =>
    encodeResponse(UserSettings, settings),
  );
});
