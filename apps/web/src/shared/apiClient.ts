import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ThreadId } from "@metaclanker/contracts/ids";
import type {
  CancelPromptRequest,
  CreateProjectRequest,
  StartThreadRequest,
} from "@metaclanker/contracts/wire";
import {
  AgentNode,
  AcceptedResponse,
  AcceptedTurnResponse,
  AuthenticationResponse,
  DirectoryBrowserResponse,
  ErrorResponse,
  Message,
  PendingInteraction,
  Project,
  ProviderReadinessResponse,
  ServerEvent,
  ShellSnapshot,
  StartThreadResponse,
  ThreadDetail,
  TicketResponse,
  ToolCall,
  UserSettings,
} from "@metaclanker/contracts/wire";

import { ApiError } from "./apiError.js";

const request = async <A>(
  operation: string,
  path: string,
  schema: Schema.ConstraintDecoder<A, never>,
  init?: RequestInit,
): Promise<A> => {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  }).catch(() => {
    throw new ApiError({ operation, kind: "network" });
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const decoded = Schema.decodeUnknownOption(ErrorResponse)(payload);
    throw new ApiError({
      operation,
      kind: "http",
      status: response.status,
      detail: Option.isSome(decoded) ? decoded.value.error.message : response.statusText,
    });
  }
  const payload: unknown = await response.json().catch(() => {
    throw new ApiError({ operation, kind: "invalid-json", status: response.status });
  });
  const decoded = Schema.decodeUnknownOption(schema)(payload);
  if (Option.isNone(decoded)) {
    throw new ApiError({ operation, kind: "invalid-response", status: response.status });
  }
  return decoded.value;
};

export const api = {
  authenticateLocal: () =>
    request("authenticate", "/api/auth/local", AuthenticationResponse, { method: "POST" }),
  shell: () => request("load workspace", "/api/shell", ShellSnapshot),
  providerReadiness: () => request("load providers", "/api/providers", ProviderReadinessResponse),
  createProject: (input: CreateProjectRequest) =>
    request("create project", "/api/projects", Project, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  browseProjectDirectories: (path?: string) =>
    request(
      "browse directories",
      `/api/projects/directories${path === undefined ? "" : `?path=${encodeURIComponent(path)}`}`,
      DirectoryBrowserResponse,
    ),
  startThread: (input: StartThreadRequest) =>
    request("start conversation", "/api/threads/start", StartThreadResponse, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  thread: (id: ThreadId) =>
    request("load conversation", `/api/threads/${encodeURIComponent(id)}`, ThreadDetail),
  prompt: (id: ThreadId, input: object) =>
    request("send prompt", `/api/threads/${encodeURIComponent(id)}/prompts`, AcceptedTurnResponse, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  cancel: (id: ThreadId, input: CancelPromptRequest) =>
    request("cancel prompt", `/api/threads/${encodeURIComponent(id)}/cancel`, AcceptedResponse, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  respond: (interactionId: string, input: object) =>
    request(
      "respond to permission",
      `/api/interactions/${encodeURIComponent(interactionId)}/respond`,
      PendingInteraction,
      { method: "POST", body: JSON.stringify(input) },
    ),
  ticket: () => request("issue ticket", "/api/auth/ticket", TicketResponse, { method: "POST" }),
  settings: () => request("load settings", "/api/settings", UserSettings),
  saveSettings: (settings: typeof UserSettings.Type) =>
    request("save settings", "/api/settings", UserSettings, {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};

export const schemas = { AgentNode, Message, PendingInteraction, ServerEvent, ToolCall };
