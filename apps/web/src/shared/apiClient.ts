import { Schema } from "effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { CreateProjectRequest, CreateThreadRequest } from "@metaclanker/contracts/wire";
import {
  AgentNode,
  Message,
  PendingInteraction,
  PersistedCheckpointWire,
  Project,
  RestorePreviewResponse,
  ReviewResponse,
  ServerEvent,
  ShellSnapshot,
  Thread,
  ThreadDetail,
  ToolCall,
  UserSettings,
} from "@metaclanker/contracts/wire";

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const decode = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown): Promise<A> =>
  Schema.decodeUnknownPromise(schema)(value);

const request = async <A, I>(
  path: string,
  schema: Schema.Schema<A, I, never>,
  init?: RequestInit,
): Promise<A> => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String(payload.message)
        : response.statusText;
    throw new ApiError(response.status, message);
  }
  return decode(schema, await response.json());
};

const AcceptedTurn = Schema.Struct({ accepted: Schema.Boolean, turnId: Schema.String });
const Accepted = Schema.Struct({ accepted: Schema.Boolean });
const Ticket = Schema.Struct({ ticket: Schema.String });
const Authentication = Schema.Struct({ authenticated: Schema.Boolean });

export const api = {
  authenticateLocal: () => request("/api/auth/local", Authentication, { method: "POST" }),
  shell: () => request("/api/shell", ShellSnapshot),
  createProject: (input: CreateProjectRequest) =>
    request("/api/projects", Project, { method: "POST", body: JSON.stringify(input) }),
  createThread: (input: CreateThreadRequest) =>
    request("/api/threads", Thread, { method: "POST", body: JSON.stringify(input) }),
  thread: (id: ThreadId) => request(`/api/threads/${encodeURIComponent(id)}`, ThreadDetail),
  prompt: (id: ThreadId, input: object) =>
    request(`/api/threads/${encodeURIComponent(id)}/prompts`, AcceptedTurn, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancel: (id: ThreadId) =>
    request(`/api/threads/${encodeURIComponent(id)}/cancel`, Accepted, { method: "POST" }),
  respond: (interactionId: string, input: object) =>
    request(`/api/interactions/${encodeURIComponent(interactionId)}/respond`, PendingInteraction, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  ticket: () => request("/api/auth/ticket", Ticket, { method: "POST" }),
  settings: () => request("/api/settings", UserSettings),
  saveSettings: (settings: typeof UserSettings.Type) =>
    request("/api/settings", UserSettings, { method: "PUT", body: JSON.stringify(settings) }),
  review: (id: ThreadId) =>
    request(`/api/threads/${encodeURIComponent(id)}/review`, ReviewResponse),
  restorePreview: (id: ThreadId, checkpointId: string) =>
    request(`/api/threads/${encodeURIComponent(id)}/restore-preview`, RestorePreviewResponse, {
      method: "POST",
      body: JSON.stringify({ checkpointId }),
    }),
  restoreFiles: (id: ThreadId, checkpointId: string) =>
    request(`/api/threads/${encodeURIComponent(id)}/restore`, PersistedCheckpointWire, {
      method: "POST",
      body: JSON.stringify({ checkpointId, confirmed: true }),
    }),
};

export const schemas = { AgentNode, Message, PendingInteraction, ServerEvent, ToolCall };
