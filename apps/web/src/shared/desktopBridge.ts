interface DesktopBridge {
  readonly platform: string;
  readonly version: string;
  readonly initialSidebarCollapsed: boolean;
  readonly selectProjectDirectory: () => Promise<string | null>;
  readonly setSidebarCollapsed: (collapsed: boolean) => Promise<void>;
  readonly readConversationDrafts: () => Promise<unknown>;
  readonly setConversationDrafts: (serialized: string) => Promise<void>;
}

declare global {
  interface Window {
    readonly metaClankerDesktop?: DesktopBridge;
  }
}

export const desktopDirectoryPickerAvailable = (): boolean =>
  window.metaClankerDesktop !== undefined;

export const selectDesktopProjectDirectory = (): Promise<string | null> =>
  window.metaClankerDesktop?.selectProjectDirectory() ?? Promise.resolve(null);

export const initialSidebarCollapsed = (): boolean =>
  window.metaClankerDesktop?.initialSidebarCollapsed ??
  window.localStorage.getItem("metaclanker:sidebar-collapsed") === "true";

export const persistSidebarCollapsed = async (collapsed: boolean): Promise<void> => {
  window.localStorage.setItem("metaclanker:sidebar-collapsed", String(collapsed));
  await window.metaClankerDesktop?.setSidebarCollapsed(collapsed);
};

export const readDesktopConversationDrafts = async (): Promise<string | null> => {
  try {
    const serialized = await window.metaClankerDesktop?.readConversationDrafts();
    return typeof serialized === "string" ? serialized : null;
  } catch {
    return null;
  }
};

export const persistDesktopConversationDrafts = async (serialized: string): Promise<void> => {
  try {
    await window.metaClankerDesktop?.setConversationDrafts(serialized);
  } catch {
    // Same-origin localStorage remains the browser fallback and the current-launch safety net.
  }
};
