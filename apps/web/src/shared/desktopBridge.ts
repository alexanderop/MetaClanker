interface DesktopBridge {
  readonly platform: string;
  readonly version: string;
  readonly selectProjectDirectory: () => Promise<string | null>;
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
