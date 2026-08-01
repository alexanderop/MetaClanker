import { createI18n } from "vue-i18n";

const messages = {
  en: {
    accessibility: { skipToContent: "Skip to main content" },
    app: { name: "MetaClanker", tagline: "Local agent control" },
    common: {
      loading: "Loading workspace…",
      retry: "Try again",
      cancel: "Cancel",
      close: "Close",
      save: "Save",
    },
    projects: {
      title: "Projects",
      add: "Add project",
      addTitle: "Open a server-side project",
      path: "Absolute project path",
      pathHint: "The path must exist on the machine running MetaClanker.",
      browse: "Choose directory",
      name: "Display name",
      nameOptional: "Optional; defaults to the directory name",
      empty: "No projects yet",
      createThread: "New thread",
    },
    thread: {
      emptyTitle: "Your agent workspace",
      emptyBody: "Add a local Git project, then start a Codex or Claude conversation.",
      provider: "Provider",
      branch: "Branch",
      map: "Agent map",
      conversation: "Conversation",
      review: "Review changes",
      send: "Send message",
      stop: "Stop turn",
      composerPlaceholder: "Ask the agent to build, investigate, or explain…",
      noMessages: "Start this conversation with a prompt.",
      activity: "Activity",
      permission: "Permission required",
    },
    map: {
      title: "Agent map",
      canvas: "Spatial map",
      tree: "Accessible tree",
      fit: "Fit view",
      empty: "Agent activity appears here after the first turn starts.",
      allProviders: "All providers",
      allStates: "All states",
      needsAttention: "Needs attention",
    },
  },
} as const;

export const i18n = createI18n({
  legacy: false,
  locale: "en",
  fallbackLocale: "en",
  messages,
});
