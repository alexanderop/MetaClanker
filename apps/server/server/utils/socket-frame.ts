import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerEvent } from "@metaclanker/contracts/wire";

/**
 * The one encode boundary for WebSocket frames. HTTP responses already go through
 * `encodeResponse`; hand-stringified frames made the client's strict `ServerEvent`
 * decode depend on the two shapes happening to coincide.
 *
 * Returns `null` when the value cannot be expressed in the public contract, so the
 * caller closes the socket instead of sending something the client will reject.
 */
export const encodeServerEvent = (event: typeof ServerEvent.Type): string | null =>
  Option.match(Schema.encodeOption(ServerEvent)(event), {
    onNone: () => null,
    onSome: (encoded) => JSON.stringify(encoded),
  });
