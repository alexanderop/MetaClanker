import { Schema } from "effect";
import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";

import { CommandId, ProjectId } from "@metaclanker/contracts/ids";
import type { ThreadId } from "@metaclanker/contracts/ids";
import type {
  PendingInteraction,
  Project,
  ProviderReadiness,
  ServerEvent,
  ShellSnapshot,
  ThreadDetail,
  UserSettings,
} from "@metaclanker/contracts/wire";
import { Provider as ProviderSchema, defaultUserSettings } from "@metaclanker/contracts/wire";

import { api, schemas } from "./apiClient.js";

const emptyShell: ShellSnapshot = { projects: [], threads: [], latestSequence: 0 };
const conversationDraftStorageKey = "metaclanker:conversation-drafts:v2";

const ConversationDraftSchema = Schema.Struct({
  projectId: ProjectId,
  commandId: CommandId,
  prompt: Schema.String,
  provider: ProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.Literal("low", "medium", "high")),
  permissionMode: Schema.NullOr(Schema.Literal("read-only", "workspace-write", "full-access")),
  attachments: Schema.Array(Schema.String),
  cursorStart: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  cursorEnd: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type ConversationDraft = typeof ConversationDraftSchema.Type;
const ConversationDraftRecordSchema = Schema.Record({
  key: Schema.String,
  value: ConversationDraftSchema,
});

const loadConversationDrafts = (): Record<string, ConversationDraft> => {
  try {
    const serialized = window.localStorage.getItem(conversationDraftStorageKey);
    if (serialized === null) return {};
    return Schema.decodeUnknownSync(ConversationDraftRecordSchema)(JSON.parse(serialized));
  } catch {
    return {};
  }
};

const applyTheme = (theme: UserSettings["theme"]): void => {
  if (theme === "system") delete document.documentElement.dataset["theme"];
  else document.documentElement.dataset["theme"] = theme;
};

const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)");

export const useWorkspaceStore = defineStore("workspace", () => {
  const shell = ref<ShellSnapshot>(emptyShell);
  const detail = shallowRef<ThreadDetail | null>(null);
  const loading = ref(true);
  const error = ref<string | null>(null);
  const drafts = ref<Record<string, string>>({});
  const conversationDrafts = ref<Record<string, ConversationDraft>>(loadConversationDrafts());
  const settings = ref<UserSettings>(defaultUserSettings);
  const providerReadiness = ref<ReadonlyArray<ProviderReadiness>>([]);
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

  // `theme` is the stored preference; this is the scheme actually on screen, which
  // the header toggle needs so that flipping out of "system" lands on the opposite
  // of what the user is currently looking at rather than on a no-op.
  const prefersDark = ref(systemPrefersDark.matches);
  systemPrefersDark.addEventListener("change", (event) => {
    prefersDark.value = event.matches;
  });

  const resolvedTheme = computed<"light" | "dark">(() => {
    const theme = settings.value.theme;
    if (theme !== "system") return theme;
    return prefersDark.value ? "dark" : "light";
  });

  const toggleTheme = async (): Promise<void> => {
    await saveSettings({
      ...settings.value,
      theme: resolvedTheme.value === "dark" ? "light" : "dark",
    });
  };

  const bootstrap = async (): Promise<void> => {
    loading.value = true;
    error.value = null;
    try {
      await api.authenticateLocal();
      const [nextShell, nextSettings, nextProviderReadiness] = await Promise.all([
        api.shell(),
        api.settings(),
        api.providerReadiness(),
      ]);
      shell.value = nextShell;
      settings.value = nextSettings;
      providerReadiness.value = nextProviderReadiness;
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
      shell.value = {
        ...shell.value,
        threads: shell.value.threads.map((thread) =>
          thread.id === event.threadId ? { ...thread, status: event.status } : thread,
        ),
      };
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

  const persistConversationDrafts = (): void => {
    window.localStorage.setItem(
      conversationDraftStorageKey,
      JSON.stringify(conversationDrafts.value),
    );
  };

  const createProject = async (path: string, name?: string): Promise<Project> => {
    const project = await api.createProject({
      commandId: CommandId.make(crypto.randomUUID()),
      path,
      ...(name === undefined || name.length === 0 ? {} : { name }),
    });
    shell.value = {
      ...shell.value,
      projects: [...shell.value.projects.filter((item) => item.id !== project.id), project],
    };
    return project;
  };

  const saveSettings = async (next: UserSettings): Promise<void> => {
    settings.value = await api.saveSettings(next);
    applyTheme(settings.value.theme);
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

  const draftForProject = (projectId: ProjectId): ConversationDraft => {
    const existing = conversationDrafts.value[projectId];
    if (existing !== undefined) return existing;
    const draft: ConversationDraft = {
      projectId,
      commandId: CommandId.make(crypto.randomUUID()),
      prompt: "",
      provider: "codex",
      model: settings.value.providerDefaults.codex.model,
      effort: settings.value.providerDefaults.codex.effort,
      permissionMode: settings.value.providerDefaults.codex.permissionMode,
      attachments: [],
      cursorStart: 0,
      cursorEnd: 0,
    };
    conversationDrafts.value = { ...conversationDrafts.value, [projectId]: draft };
    persistConversationDrafts();
    return draft;
  };

  const updateConversationDraft = (
    projectId: ProjectId,
    patch: Partial<Omit<ConversationDraft, "projectId" | "commandId">>,
  ): ConversationDraft => {
    const current = draftForProject(projectId);
    const next = { ...current, ...patch };
    conversationDrafts.value = { ...conversationDrafts.value, [projectId]: next };
    persistConversationDrafts();
    return next;
  };

  const discardConversationDraft = (projectId: ProjectId): void => {
    const next = { ...conversationDrafts.value };
    delete next[projectId];
    conversationDrafts.value = next;
    persistConversationDrafts();
  };

  const startConversation = async (projectId: ProjectId): Promise<ThreadId> => {
    const draft = draftForProject(projectId);
    const readiness = providerReadiness.value.find((item) => item.provider === draft.provider);
    if (readiness?.status !== "ready") {
      throw new Error(readiness?.reason ?? `The ${draft.provider} provider is unavailable`);
    }
    const prompt = draft.prompt.trim();
    if (prompt.length === 0 && draft.attachments.length === 0) {
      throw new Error("Write a message or add an attachment before sending");
    }
    const result = await api.startThread({
      commandId: draft.commandId,
      projectId,
      provider: draft.provider,
      ...(draft.model === null || draft.model.trim().length === 0 ? {} : { model: draft.model }),
      ...(draft.effort === null ? {} : { effort: draft.effort }),
      ...(draft.permissionMode === null ? {} : { permissionMode: draft.permissionMode }),
      prompt,
      attachments: draft.attachments,
    });
    shell.value = {
      ...shell.value,
      threads: [
        result.thread,
        ...shell.value.threads.filter((item) => item.id !== result.thread.id),
      ],
    };
    return result.thread.id;
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
    conversationDrafts,
    settings,
    providerReadiness,
    selectedProject,
    resolvedTheme,
    toggleTheme,
    bootstrap,
    loadThread,
    createProject,
    draftForProject,
    updateConversationDraft,
    discardConversationDraft,
    startConversation,
    saveSettings,
    sendPrompt,
    cancelPrompt,
    respond,
    draftFor,
    setDraft,
  };
});
