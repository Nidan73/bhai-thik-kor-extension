import { describe, expect, it } from 'vitest';
import {
  fitPromptToBudget,
  getDomainHint,
  getOutputWordBudget,
  looksStructured,
  prepareGenerateRequest,
} from '../src/shared/prompt-quality';
import { PROMPT_MAX_CHARS } from '../src/shared/constants';

describe('fitPromptToBudget', () => {
  it('leaves a short prompt untouched', () => {
    const result = fitPromptToBudget('write a poem');
    expect(result.prompt).toBe('write a poem');
    expect(result.wasTrimmed).toBe(false);
  });

  it('leaves a prompt at exactly the limit untouched', () => {
    const result = fitPromptToBudget('x'.repeat(PROMPT_MAX_CHARS));
    expect(result.wasTrimmed).toBe(false);
  });

  it('trims an oversized prompt to within the limit', () => {
    const result = fitPromptToBudget('x'.repeat(PROMPT_MAX_CHARS + 5000));
    expect(result.wasTrimmed).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it('keeps the head and the tail of an oversized prompt', () => {
    const body = 'M'.repeat(PROMPT_MAX_CHARS + 5000);
    const result = fitPromptToBudget(`HEAD${body}TAIL`);
    expect(result.prompt.startsWith('HEAD')).toBe(true);
    expect(result.prompt.endsWith('TAIL')).toBe(true);
  });
});

describe('getOutputWordBudget', () => {
  it('scales with prompt length', () => {
    expect(getOutputWordBudget('x'.repeat(40))).toBe('60-140');
    expect(getOutputWordBudget('x'.repeat(200))).toBe('120-260');
    expect(getOutputWordBudget('x'.repeat(800))).toBe('250-550');
    expect(getOutputWordBudget('x'.repeat(2000))).toBe('300-700');
  });
});

describe('looksStructured', () => {
  it('detects a framework heading', () => {
    expect(looksStructured('Role: senior engineer\nTask: review code')).toBe(true);
  });

  it('rejects prose that merely mentions a heading word', () => {
    expect(looksStructured('my role at work is hard')).toBe(false);
  });
});

describe('getDomainHint', () => {
  it('routes code prompts to the web/app hint', () => {
    expect(getDomainHint('build a react app')).toMatch(/web\/app\/code/);
  });

  it('routes writing prompts to the copy hint', () => {
    expect(getDomainHint('draft an email to my landlord')).toMatch(/writing or copy/);
  });

  it('routes design prompts to the design hint', () => {
    expect(getDomainHint('make a logo for my bakery')).toMatch(/design tasks/);
  });

  it('routes analysis prompts to the analysis hint', () => {
    expect(getDomainHint('summarize this research paper')).toMatch(/analysis tasks/);
  });

  it('falls back when no domain matches', () => {
    expect(getDomainHint('hello there friend')).toMatch(/Choose the expert role/);
  });
});

describe('prepareGenerateRequest', () => {
  it('appends quality clarifications and preserves persona profile', () => {
    const { clarifications } = prepareGenerateRequest('write a python script', [], {
      persona: 'Role: Senior Dev | Stack: Python, Django | Tone: direct',
    });
    expect(clarifications).toHaveLength(4);
    const domainClarification = clarifications.find(c => c.question === 'Domain-specific quality hints');
    expect(domainClarification?.answer).toContain('User style profile: Role: Senior Dev | Stack: Python, Django | Tone: direct');
  });
});

