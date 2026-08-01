import { Schema } from "effect";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type { CreateProjectRequest, StartThreadRequest } from "@metaclanker/contracts/wire";
import {
  AgentNode,
  DirectoryBrowserResponse,
  Message,
  PendingInteraction,
  PersistedCheckpointWire,
  Project,
  ProviderReadinessResponse,
  RestorePreviewResponse,
  ReviewResponse,
  ServerEvent,
  ShellSnapshot,
  StartThreadResponse,
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
  providerReadiness: () => request("/api/providers", ProviderReadinessResponse),
  createProject: (input: CreateProjectRequest) =>
    request("/api/projects", Project, { method: "POST", body: JSON.stringify(input) }),
  browseProjectDirectories: (path?: string) =>
    request(
      `/api/projects/directories${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`,
      DirectoryBrowserResponse,
    ),
  startThread: (input: StartThreadRequest) =>
    request("/api/threads/start", StartThreadResponse, {
      method: "POST",
      body: JSON.stringify(input),
    }),
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
