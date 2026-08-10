import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, pruneHistory, type HistoryEntry } from '../src/shared/history';

function entry(id: string): HistoryEntry {
  return { id, at: 0, original: 'a', optimized: 'b', source: 'popup' };
}

describe('pruneHistory', () => {
  it('leaves a short list untouched', () => {
    const entries = [entry('1'), entry('2')];
    expect(pruneHistory(entries)).toEqual(entries);
  });

  it('caps the list at the limit', () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(String(i)));
    expect(pruneHistory(entries)).toHaveLength(HISTORY_LIMIT);
  });

  it('drops the oldest entries, keeping the newest first', () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => entry(String(i)));
    const pruned = pruneHistory(entries);
    expect(pruned[0].id).toBe('0');
    expect(pruned.at(-1)?.id).toBe(String(HISTORY_LIMIT - 1));
  });

  it('keeps exactly the limit at the boundary', () => {
    const entries = Array.from({ length: HISTORY_LIMIT }, (_, i) => entry(String(i)));
    expect(pruneHistory(entries)).toHaveLength(HISTORY_LIMIT);
  });
});
