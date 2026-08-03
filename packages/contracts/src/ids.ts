import * as Schema from "effect/Schema";

const IdString = Schema.NonEmptyString;

export const ProjectId = IdString.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ThreadId = IdString.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const TurnId = IdString.pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

export const MessageId = IdString.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export const ToolCallId = IdString.pipe(Schema.brand("ToolCallId"));
export type ToolCallId = typeof ToolCallId.Type;

export const AgentNodeId = IdString.pipe(Schema.brand("AgentNodeId"));
export type AgentNodeId = typeof AgentNodeId.Type;

export const CommandId = IdString.pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandId.Type;

export const PendingInteractionId = IdString.pipe(Schema.brand("PendingInteractionId"));
export type PendingInteractionId = typeof PendingInteractionId.Type;

export const CheckpointId = IdString.pipe(Schema.brand("CheckpointId"));
export type CheckpointId = typeof CheckpointId.Type;

export const EventId = IdString.pipe(Schema.brand("EventId"));
export type EventId = typeof EventId.Type;

export const SessionId = IdString.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const Sequence = Schema.Natural;
export type Sequence = typeof Sequence.Type;

export const decodeId = <A>(schema: Schema.ConstraintDecoder<A, never>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value);
