import { ThreadId } from "@metaclanker/contracts/ids";
import { AcceptedResponse, CancelPromptRequest } from "@metaclanker/contracts/wire";

import {
  decodeBody,
  decodeRouteParam,
  defineApiHandler,
  encodeResponse,
} from "../../../utils/http.js";
import { runAgentCommand } from "../../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const input = await decodeBody(event, CancelPromptRequest);
  await runAgentCommand((commands) => commands.cancelPrompt(input.commandId, id));
  return encodeResponse(AcceptedResponse, { accepted: true });
});
