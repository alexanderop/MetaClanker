import { Schema } from "effect";
import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, shallowRef } from "vue";

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
import { applyShellEvent } from "./live-shell-state.js";
import { applyThreadEvent } from "./live-thread-state.js";
import { createSerialConsumer } from "./serial-consumer.js";

const emptyShell: ShellSnapshot = { projects: [], threads: [], latestSequence: 0 };
const conversationDraftStorageKey = "metaclanker:conversation-drafts:v2";

const ConversationDraftSchema = Schema.Struct({
  projectId: ProjectId,
  commandId: CommandId,
  prompt: Schema.String,
  provider: ProviderSchema,
  model: Schema.NullOr(Schema.String),
  effort: Schema.NullOr(Schema.Literals(["low", "medium", "high"])),
  permissionMode: Schema.NullOr(Schema.Literals(["read-only", "workspace-write", "full-access"])),
  attachments: Schema.Array(Schema.String),
  cursorStart: Schema.Natural,
  cursorEnd: Schema.Natural,
});
export type ConversationDraft = typeof ConversationDraftSchema.Type;
const ConversationDraftRecordSchema = Schema.Record(Schema.String, ConversationDraftSchema);

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
  let shellSocket: WebSocket | null = null;
  let reconnectAttempt = 0;
  let shellReconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shellReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedThreadId: ThreadId | null = null;
  let bootstrapGeneration = 0;
  let threadLoadGeneration = 0;
  let threadSocketGeneration = 0;
  let shellSocketGeneration = 0;
  let snapshotLoading = false;
  let shellSnapshotLoading = false;
  let mediaListenerAttached = true;

  const selectedProject = computed(() => {
    const projectId = detail.value?.thread.projectId;
    return shell.value.projects.find((project) => project.id === projectId) ?? null;
  });

  // `theme` is the stored preference; this is the scheme actually on screen, which
  // the header toggle needs so that flipping out of "system" lands on the opposite
  // of what the user is currently looking at rather than on a no-op.
  const prefersDark = ref(systemPrefersDark.matches);
  const updateSystemTheme = (event: MediaQueryListEvent): void => {
    prefersDark.value = event.matches;
  };
  systemPrefersDark.addEventListener("change", updateSystemTheme);

  const ensureMediaListener = (): void => {
    if (mediaListenerAttached) return;
    systemPrefersDark.addEventListener("change", updateSystemTheme);
    mediaListenerAttached = true;
  };

  const clearReconnectTimer = (): void => {
    if (reconnectTimer === null) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const clearShellReconnectTimer = (): void => {
    if (shellReconnectTimer === null) return;
    clearTimeout(shellReconnectTimer);
    shellReconnectTimer = null;
  };

  const closeThreadSocket = (): void => {
    threadSocketGeneration += 1;
    const current = socket;
    socket = null;
    current?.close();
  };

  const closeShellSocket = (): void => {
    shellSocketGeneration += 1;
    const current = shellSocket;
    shellSocket = null;
    current?.close();
  };

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
    const generation = ++bootstrapGeneration;
    ensureMediaListener();
    closeShellSocket();
    clearShellReconnectTimer();
    loading.value = true;
    error.value = null;
    try {
      await api.authenticateLocal();
      const [nextShell, nextSettings, nextProviderReadiness] = await Promise.all([
        api.shell(),
        api.settings(),
        api.providerReadiness(),
      ]);
      if (generation !== bootstrapGeneration) return;
      shell.value = nextShell;
      settings.value = nextSettings;
      providerReadiness.value = nextProviderReadiness;
      applyTheme(nextSettings.theme);
      await subscribeShell();
    } catch (cause) {
      if (generation !== bootstrapGeneration) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === bootstrapGeneration) loading.value = false;
    }
  };

  const loadThread = async (id: ThreadId): Promise<void> => {
    const generation = ++threadLoadGeneration;
    selectedThreadId = id;
    closeThreadSocket();
    clearReconnectTimer();
    snapshotLoading = false;
    loading.value = true;
    error.value = null;
    try {
      const snapshot = await api.thread(id);
      if (generation !== threadLoadGeneration || selectedThreadId !== id) return;
      detail.value = snapshot;
      await subscribe(id);
    } catch (cause) {
      if (generation !== threadLoadGeneration || selectedThreadId !== id) return;
      error.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (generation === threadLoadGeneration) loading.value = false;
    }
  };

  const applyEvent = (event: ServerEvent): void => {
    const current = detail.value;
    if (event.type === "snapshot-required") {
      if (selectedThreadId !== null) void synchronizeSnapshot(selectedThreadId);
      return;
    }
    if (snapshotLoading) return;
    if (current === null) {
      if (selectedThreadId !== null) void synchronizeSnapshot(selectedThreadId);
      return;
    }
    const next = applyThreadEvent({ shell: shell.value, detail: current }, event);
    shell.value = next.shell;
    detail.value = next.detail;
  };

  const synchronizeSnapshot = async (id: ThreadId): Promise<void> => {
    if (snapshotLoading || selectedThreadId !== id) return;
    snapshotLoading = true;
    closeThreadSocket();
    clearReconnectTimer();
    try {
      const snapshot = await api.thread(id);
      if (selectedThreadId !== id) return;
      detail.value = snapshot;
      error.value = null;
      snapshotLoading = false;
      await subscribe(id);
    } catch (cause) {
      if (selectedThreadId !== id) return;
      error.value = `The conversation could not be resynchronized: ${cause instanceof Error ? cause.message : String(cause)}`;
      const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt) + Math.random() * 250;
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void synchronizeSnapshot(id);
      }, delay);
    } finally {
      snapshotLoading = false;
    }
  };

  const scheduleThreadReconnect = (id: ThreadId): void => {
    if (selectedThreadId !== id) return;
    clearReconnectTimer();
    const delay = Math.min(10_000, 500 * 2 ** reconnectAttempt) + Math.random() * 250;
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void subscribe(id).catch((cause: unknown) => {
        if (selectedThreadId !== id) return;
        error.value = `The conversation could not reconnect: ${cause instanceof Error ? cause.message : String(cause)}`;
        scheduleThreadReconnect(id);
      });
    }, delay);
  };

  async function subscribe(id: ThreadId): Promise<void> {
    closeThreadSocket();
    clearReconnectTimer();
    const generation = threadSocketGeneration;
    const { ticket } = await api.ticket();
    if (generation !== threadSocketGeneration || selectedThreadId !== id) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(
      `${protocol}//${window.location.host}/api/threads/${encodeURIComponent(id)}/events?ticket=${encodeURIComponent(ticket)}&afterSequence=${String(detail.value?.latestSequence ?? 0)}`,
    );
    socket = nextSocket;
    nextSocket.addEventListener("open", () => {
      if (generation !== threadSocketGeneration) return;
      reconnectAttempt = 0;
      error.value = null;
    });
    const eventConsumer = createSerialConsumer(
      (event: ServerEvent) => {
        if (generation === threadSocketGeneration) applyEvent(event);
      },
      (cause) => {
        if (generation === threadSocketGeneration) {
          error.value = `The live update stream sent invalid data: ${String(cause)}`;
        }
      },
    );
    nextSocket.addEventListener("message", (message) => {
      if (message.data === "pong" || typeof message.data !== "string") return;
      const data = message.data;
      eventConsumer.push(() =>
        Promise.resolve(data)
          .then((serialized): unknown => JSON.parse(serialized))
          .then(Schema.decodeUnknownPromise(schemas.ServerEvent)),
      );
    });
    nextSocket.addEventListener("close", () => {
      if (generation !== threadSocketGeneration || selectedThreadId !== id) return;
      socket = null;
      scheduleThreadReconnect(id);
    });
  }

  const applyShellLiveEvent = (event: ServerEvent): void => {
    if (event.type === "snapshot-required") {
      void synchronizeShellSnapshot();
      return;
    }
    if (shellSnapshotLoading) return;
    shell.value = applyShellEvent(shell.value, event);
  };

  const synchronizeShellSnapshot = async (): Promise<void> => {
    if (shellSnapshotLoading) return;
    shellSnapshotLoading = true;
    closeShellSocket();
    clearShellReconnectTimer();
    try {
      shell.value = await api.shell();
      error.value = null;
      shellSnapshotLoading = false;
      await subscribeShell();
    } catch (cause) {
      error.value = `The workspace could not be resynchronized: ${cause instanceof Error ? cause.message : String(cause)}`;
      const delay = Math.min(10_000, 500 * 2 ** shellReconnectAttempt) + Math.random() * 250;
      shellReconnectAttempt += 1;
      shellReconnectTimer = setTimeout(() => {
        shellReconnectTimer = null;
        void synchronizeShellSnapshot();
      }, delay);
    } finally {
      shellSnapshotLoading = false;
    }
  };

  const scheduleShellReconnect = (): void => {
    clearShellReconnectTimer();
    const generation = shellSocketGeneration;
    const delay = Math.min(10_000, 500 * 2 ** shellReconnectAttempt) + Math.random() * 250;
    shellReconnectAttempt += 1;
    shellReconnectTimer = setTimeout(() => {
      shellReconnectTimer = null;
      if (generation !== shellSocketGeneration) return;
      const reconnect = subscribeShell();
      const reconnectGeneration = shellSocketGeneration;
      void reconnect.catch((cause: unknown) => {
        if (reconnectGeneration !== shellSocketGeneration) return;
        error.value = `The workspace could not reconnect: ${cause instanceof Error ? cause.message : String(cause)}`;
        scheduleShellReconnect();
      });
    }, delay);
  };

  async function subscribeShell(): Promise<void> {
    closeShellSocket();
    clearShellReconnectTimer();
    const generation = shellSocketGeneration;
    const { ticket } = await api.ticket();
    if (generation !== shellSocketGeneration) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const nextSocket = new WebSocket(
      `${protocol}//${window.location.host}/api/shell/events?ticket=${encodeURIComponent(ticket)}&afterSequence=${String(shell.value.latestSequence)}`,
    );
    shellSocket = nextSocket;
    nextSocket.addEventListener("open", () => {
      if (generation !== shellSocketGeneration) return;
      shellReconnectAttempt = 0;
      error.value = null;
    });
    const eventConsumer = createSerialConsumer(
      (event: ServerEvent) => {
        if (generation === shellSocketGeneration) applyShellLiveEvent(event);
      },
      (cause) => {
        if (generation === shellSocketGeneration) {
          error.value = `The workspace update stream sent invalid data: ${String(cause)}`;
        }
      },
    );
    nextSocket.addEventListener("message", (message) => {
      if (message.data === "pong" || typeof message.data !== "string") return;
      const data = message.data;
      eventConsumer.push(() =>
        Promise.resolve(data)
          .then((serialized): unknown => JSON.parse(serialized))
          .then(Schema.decodeUnknownPromise(schemas.ServerEvent)),
      );
    });
    nextSocket.addEventListener("close", () => {
      if (generation !== shellSocketGeneration) return;
      shellSocket = null;
      scheduleShellReconnect();
    });
  }

  const disconnect = (): void => {
    bootstrapGeneration += 1;
    threadLoadGeneration += 1;
    selectedThreadId = null;
    snapshotLoading = false;
    shellSnapshotLoading = false;
    clearReconnectTimer();
    clearShellReconnectTimer();
    closeThreadSocket();
    closeShellSocket();
    if (mediaListenerAttached) {
      systemPrefersDark.removeEventListener("change", updateSystemTheme);
      mediaListenerAttached = false;
    }
  };

  onScopeDispose(disconnect);

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
    await api.cancel(detail.value.thread.id, { commandId: CommandId.make(crypto.randomUUID()) });
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
    disconnect,
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
