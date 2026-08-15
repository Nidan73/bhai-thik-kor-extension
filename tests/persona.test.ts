import { describe, expect, it } from 'vitest';
import { inferPersonaFromHistory } from '../src/shared/persona';
import type { HistoryEntry } from '../src/shared/history';

function mockEntry(original: string): HistoryEntry {
  return {
    id: 'test-1',
    at: Date.now(),
    original,
    optimized: 'Optimized...',
    source: 'popup',
  };
}

describe('inferPersonaFromHistory', () => {
  it('returns null for empty or single entries', () => {
    expect(inferPersonaFromHistory([])).toBeNull();
    expect(inferPersonaFromHistory([mockEntry('write a react app')])).toBeNull();
  });

  it('detects a developer persona with React and TypeScript', () => {
    const entries = [
      mockEntry('build a react component for modal with typescript'),
      mockEntry('how to handle async state in next.js with tailwind'),
    ];
    const persona = inferPersonaFromHistory(entries);
    expect(persona).not.toBeNull();
    expect(persona?.role).toBe('Software Developer');
    expect(persona?.summary).toContain('Software Developer');
    expect(persona?.summary).toMatch(/React|Typescript/);
  });

  it('detects a writer persona for copy/email prompts', () => {
    const entries = [
      mockEntry('write an email to client about project delay'),
      mockEntry('draft a linkedin post announcing new job'),
    ];
    const persona = inferPersonaFromHistory(entries);
    expect(persona).not.toBeNull();
    expect(persona?.role).toBe('Writer & Communicator');
    expect(persona?.summary).toContain('Writer & Communicator');
  });

  it('detects concise tone preference for short prompts', () => {
    const entries = [
      mockEntry('fix react bug'),
      mockEntry('add next.js api route'),
    ];
    const persona = inferPersonaFromHistory(entries);
    expect(persona?.tone).toContain('concise');
  });
});
