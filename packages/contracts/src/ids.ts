import { Schema } from "effect";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const ThreadId = Schema.String.pipe(Schema.brand("ThreadId"));
export type ThreadId = typeof ThreadId.Type;

export const TurnId = Schema.String.pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export const ToolCallId = Schema.String.pipe(Schema.brand("ToolCallId"));
export type ToolCallId = typeof ToolCallId.Type;

export const AgentNodeId = Schema.String.pipe(Schema.brand("AgentNodeId"));
export type AgentNodeId = typeof AgentNodeId.Type;

export const CommandId = Schema.String.pipe(Schema.brand("CommandId"));
export type CommandId = typeof CommandId.Type;

export const PendingInteractionId = Schema.String.pipe(Schema.brand("PendingInteractionId"));
export type PendingInteractionId = typeof PendingInteractionId.Type;

export const CheckpointId = Schema.String.pipe(Schema.brand("CheckpointId"));
export type CheckpointId = typeof CheckpointId.Type;

export const EventId = Schema.String.pipe(Schema.brand("EventId"));
export type EventId = typeof EventId.Type;

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"));
export type SessionId = typeof SessionId.Type;

export const Sequence = Schema.Number.pipe(Schema.int(), Schema.nonNegative());
export type Sequence = typeof Sequence.Type;

export const decodeId = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value);
