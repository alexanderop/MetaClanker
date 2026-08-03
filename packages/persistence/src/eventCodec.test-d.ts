import type { DomainEvent, UnsequencedDomainEvent } from "@metaclanker/domain/persisted-events";

import type { UnsequencedDomainEventSchema } from "./eventCodec.js";

/**
 * `packages/domain` stays Effect-free, so it cannot derive its event types from this
 * schema directly. These assignments make the two definitions one contract instead of
 * two hand-maintained copies: a field added, removed, or retyped on either side stops
 * the build here rather than surfacing as an undecodable journal at crash recovery.
 */
type SchemaEvent = (typeof UnsequencedDomainEventSchema)["Type"];

/** Everything the store may write must be a shape the schema accepts. */
export const writable: SchemaEvent = null as unknown as UnsequencedDomainEvent;

/** Everything the schema accepts must be a shape the domain projections handle. */
export const readable: UnsequencedDomainEvent = null as unknown as SchemaEvent;

/** `Omit` collapses a union, so distribute it across the members first. */
type PerMember<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A sequenced event is its unsequenced shape plus the journal's own metadata. */
export const sequenced: UnsequencedDomainEvent = null as unknown as PerMember<
  DomainEvent,
  "schemaVersion" | "sequence" | "eventId" | "receivedAt"
>;
