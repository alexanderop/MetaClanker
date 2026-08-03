import { deleteThread } from "@metaclanker/application/workspace";
import { ThreadId } from "@metaclanker/contracts/ids";
import { RemovedResponse } from "@metaclanker/contracts/wire";

import { decodeRouteParam, defineApiHandler, encodeResponse } from "../../utils/http.js";
import { publishShellEvent, publishThreadEvent } from "../../utils/hub.js";
import { runApplication } from "../../utils/runtime.js";

export default defineApiHandler(async (event) => {
  const id = await decodeRouteParam(event, "id", ThreadId);
  const result = await runApplication(deleteThread(id));
  const liveEvent = {
    type: "thread-removed",
    threadId: result.record,
    sequence: result.eventSequence,
  } as const;
  await publishShellEvent(liveEvent);
  await publishThreadEvent(result.record, liveEvent);
  return encodeResponse(RemovedResponse, { removed: true });
});
