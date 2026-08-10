import type { ImproveSource } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type HistoryEntry = {
  id: string;
  at: number;
  original: string;
  optimized: string;
  source: ImproveSource;
  /** Absent for popup-originated improves, which have no tab context. */
  host?: string;
};

export const HISTORY_LIMIT = 50;

const HISTORY_KEY = 'history';

/**
 * Every write is a read-modify-write, so two improves finishing close together
 * would interleave their awaits and drop an entry. Being the only *writer* is
 * not enough; the writes also have to be serialized.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(operation: () => Promise<void>): Promise<void> {
  writeQueue = writeQueue.then(operation, operation);
  return writeQueue;
}

// ─── Pure Logic ─────────────────────────────────────────────────────────────────

/** Entries are stored newest first; the oldest fall off the end. */
export function pruneHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.slice(0, HISTORY_LIMIT);
}

// ─── Storage ────────────────────────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const entries = data?.[HISTORY_KEY];
    return Array.isArray(entries) ? (entries as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Best-effort: a failed write must never surface into the improve flow. */
export function appendHistory(entry: HistoryEntry): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const entries = await getHistory();
      await chrome.storage.local.set({ [HISTORY_KEY]: pruneHistory([entry, ...entries]) });
    } catch (err) {
      console.warn('History write failed', err);
    }
  });
}

export function deleteHistoryEntry(id: string): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const entries = await getHistory();
      await chrome.storage.local.set({ [HISTORY_KEY]: entries.filter(item => item.id !== id) });
    } catch (err) {
      console.warn('History delete failed', err);
    }
  });
}

export function clearHistory(): Promise<void> {
  return enqueueWrite(async () => {
    try {
      await chrome.storage.local.remove(HISTORY_KEY);
    } catch (err) {
      console.warn('History clear failed', err);
    }
  });
}
