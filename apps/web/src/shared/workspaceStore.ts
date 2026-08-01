import { Schema } from "effect";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

import { CommandId } from "@metaclanker/contracts/ids";
import type { ProjectId, ThreadId } from "@metaclanker/contracts/ids";
import type {
  PendingInteraction,
  Provider,
  ServerEvent,
  ShellSnapshot,
  ThreadDetail,
  UserSettings,
} from "@metaclanker/contracts/wire";
import { defaultUserSettings } from "@metaclanker/contracts/wire";

import { api, schemas } from "./apiClient.js";

const emptyShell: ShellSnapshot = { projects: [], threads: [], latestSequence: 0 };

const applyTheme = (theme: UserSettings["theme"]): void => {
  if (theme === "system") delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = theme;
};

export const useWorkspaceStore = defineStore("workspace", () => {
  const shell = ref<ShellSnapshot>(emptyShell);
  const detail = shallowRef<ThreadDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const drafts = ref<Record<string, string>>({});
  const settings = ref<UserSettings>(defaultUserSettings);
  let socket: WebSocket | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedThreadId: ThreadId | null = null;
  let snapshotLoading = false;
  let bufferedEvents: ServerEvent[] = [];

  const selectedProject = computed(() => {
    const projectId = detail.value?.thread.projectId;
    return shell.value.projects.find((project) => project.id === projectId) ?? null;
  });

  const bootstrap = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      await api.authenticateLocal();
      const [nextShell, nextSettings] = await Promise.all([api.shell(), api.settings()]);
      shell.value = nextShell;
      settings.value = nextSettings;
      applyTheme(nextSettings.theme);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  };

  const loadThread = async (id: ThreadId): Promise<void> => {
    selectedThreadId = id;
    loading.value = true;
    error.value = null;
    try {
      detail.value = await api.thread(id);
      await subscribe(id);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading.value = false;
    }
  };

  const applyEvent = (event: ServerEvent): void => {
    const current = detail.value;
    if (event.type === "snapshot-required") {
      if (selectedThreadId !== null) void synchronizeSnapshot(selectedThreadId);
      return;
    }
    if (snapshotLoading) {
      bufferedEvents.push(event);
      return;
    }
    if (current === null) {
      if (selectedThreadId !== null) void synchronizeSnapshot(selectedThreadId);
      return;
    }
    if (event.type === "synchronized") return;
    if (event.type === "thread-status") {
      detail.value = { ...current, thread: { ...current.thread, status: event.status } };
      return;
    }
    if (event.type === "message-upserted") {
      const messages = [
        ...current.messages.filter((message) => message.id !== event.message.id),
        event.message,
      ].toSorted((left, right) => left.sequence - right.sequence);
      detail.value = { ...current, messages, latestSequence: event.sequence };
      return;
    }
    if (event.type === "tool-upserted") {
      detail.value = {
        ...current,
        toolCalls: [
          ...current.toolCalls.filter((tool) => tool.id !== event.toolCall.id),
          event.toolCall,
        ],
        latestSequence: event.sequence,
      };
      return;
    }
    if (event.type === "interaction-upserted") {
      detail.value = {
        ...current,
        interactions: [
          ...current.interactions.filter((item) => item.id !== event.interaction.id),
          event.interaction,
        ],
        latestSequence: event.sequence,
      };
      return;
    }
    detail.value = {
      ...current,
      agentNodes: [...current.agentNodes.filter((node) => node.id !== event.node.id), event.node],
      latestSequence: event.sequence,
    };
  };

  const synchronizeSnapshot = async (id: ThreadId): Promise<void> => {
    if (snapshotLoading) return;
    snapshotLoading = true;
    const snapshot = await api.thread(id);
    if (selectedThreadId !== id) {
      snapshotLoading = false;
      return;
    }
    detail.value = snapshot;
    const pending = bufferedEvents
      .filter((event) => "sequence" in event && event.sequence > snapshot.latestSequence)
      .toSorted((left, right) => {
        const leftSequence = "sequence" in left ? left.sequence : 0;
        const rightSequence = "sequence" in right ? right.sequence : 0;
        return leftSequence - rightSequence;
      });
    bufferedEvents = [];
    snapshotLoading = false;
    for (const event of pending) applyEvent(event);
  };

  const subscribe = async (id: ThreadId): Promise<void> => {
    socket?.close();
    bufferedEvents = [];
    snapshotLoading = false;
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    const { ticket } = await api.ticket();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(
      `${protocol}//${window.location.host}/api/threads/${encodeURIComponent(id)}/events?ticket=${encodeURIComponent(ticket)}`,
    );
    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
    });
    socket.addEventListener("message", (message) => {
      if (message.data === "pong" || typeof message.data !== "string") return;
      void Promise.resolve(message.data)
        .then((data): unknown => JSON.parse(data))
        .then(Schema.decodeUnknownPromise(schemas.ServerEvent))
        .then(applyEvent, (cause) => {
          error.value = `The live update stream sent invalid data: ${String(cause)}`;
        });
    });
    socket.addEventListener("close", () => {
      if (selectedThreadId !== id) return;
      const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt) + Math.random() * 250;
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => void subscribe(id), delay);
    });
  };

  const createProject = async (path: string, name?: string): Promise<void> => {
    const project = await api.createProject({
      commandId: CommandId.make(crypto.randomUUID()),
      path,
      ...(name === undefined || name.length === 0 ? {} : { name }),
    });
    shell.value = { ...shell.value, projects: [...shell.value.projects, project] };
  };

  const saveSettings = async (next: UserSettings): Promise<void> => {
    settings.value = await api.saveSettings(next);
    applyTheme(settings.value.theme);
  };

  const createThread = async (projectId: ProjectId, provider: Provider): Promise<ThreadId> => {
    const thread = await api.createThread({
      commandId: CommandId.make(crypto.randomUUID()),
      projectId,
      provider,
    });
    shell.value = { ...shell.value, threads: [thread, ...shell.value.threads] };
    return thread.id;
  };

  const sendPrompt = async (text: string): Promise<void> => {
    const current = detail.value;
    if (current === null) return;
    drafts.value[current.thread.id] = "";
    await api.prompt(current.thread.id, {
      commandId: CommandId.make(crypto.randomUUID()),
      threadId: current.thread.id,
      prompt: text,
    });
  };

  const cancelPrompt = async (): Promise<void> => {
    if (detail.value === null) return;
    await api.cancel(detail.value.thread.id);
  };

  const respond = async (interaction: PendingInteraction, optionId: string): Promise<void> => {
    const resolved = await api.respond(interaction.id, {
      commandId: CommandId.make(crypto.randomUUID()),
      interactionId: interaction.id,
      optionId,
    });
    if (detail.value === null) return;
    detail.value = {
      ...detail.value,
      interactions: [
        ...detail.value.interactions.filter((item) => item.id !== resolved.id),
        resolved,
      ],
    };
  };

  const draftFor = (id: ThreadId): string => drafts.value[id] ?? "";
  const setDraft = (id: ThreadId, value: string): void => {
    drafts.value[id] = value;
  };

  return {
    shell,
    detail,
    loading,
    error,
    drafts,
    settings,
    selectedProject,
    bootstrap,
    loadThread,
    createProject,
    createThread,
    saveSettings,
    sendPrompt,
    cancelPrompt,
    respond,
    draftFor,
    setDraft,
  };
});
