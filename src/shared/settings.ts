// ─── Types ──────────────────────────────────────────────────────────────────────

export type ImproveBehavior = 'replace' | 'preview';

export type Settings = {
  floatingButton: boolean;
  disabledHosts: string[];
  improveBehavior: ImproveBehavior;
  historyEnabled: boolean;
  seenWelcome: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  floatingButton: true,
  disabledHosts: [],
  improveBehavior: 'replace',
  historyEnabled: false,
  seenWelcome: false,
};

export const MAX_DISABLED_HOSTS = 100;

const SETTINGS_KEY = 'settings';

// ─── Pure Logic ─────────────────────────────────────────────────────────────────

/**
 * Merge stored values over the defaults. Never throws, never returns undefined:
 * a broken settings read must not be able to disable improving.
 */
export function mergeSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_SETTINGS, disabledHosts: [] };
  }

  const raw = stored as Record<string, unknown>;

  return {
    floatingButton:
      typeof raw.floatingButton === 'boolean' ? raw.floatingButton : DEFAULT_SETTINGS.floatingButton,
    disabledHosts: Array.isArray(raw.disabledHosts)
      ? raw.disabledHosts
          .filter((host): host is string => typeof host === 'string' && host.length > 0)
          .slice(0, MAX_DISABLED_HOSTS)
      : [],
    improveBehavior:
      raw.improveBehavior === 'preview' || raw.improveBehavior === 'replace'
        ? raw.improveBehavior
        : DEFAULT_SETTINGS.improveBehavior,
    historyEnabled:
      typeof raw.historyEnabled === 'boolean' ? raw.historyEnabled : DEFAULT_SETTINGS.historyEnabled,
    seenWelcome:
      typeof raw.seenWelcome === 'boolean' ? raw.seenWelcome : DEFAULT_SETTINGS.seenWelcome,
  };
}

export function isHostDisabled(settings: Settings, hostname: string): boolean {
  return settings.disabledHosts.includes(hostname.toLowerCase());
}

// ─── Storage ────────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return mergeSettings(data?.[SETTINGS_KEY]);
  } catch {
    return mergeSettings(undefined);
  }
}

/** Returns false when the write failed (sync disabled, quota exceeded). */
export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<boolean> {
  try {
    const current = await getSettings();
    await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...current, [key]: value } });
    return true;
  } catch {
    return false;
  }
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
    callback(mergeSettings(changes[SETTINGS_KEY].newValue));
  });
}
