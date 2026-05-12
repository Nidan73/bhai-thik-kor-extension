import { PROMPT_MAX_CHARS } from './constants';
import type { Clarification } from './types';

const TRIM_NOTICE =
  '[Middle omitted by extension to stay inside the request budget. Preserve the visible intent.]';

const HEAD_CHARS = 3150;
const TAIL_CHARS = PROMPT_MAX_CHARS - HEAD_CHARS - TRIM_NOTICE.length - 4;

export function prepareGenerateRequest(
  prompt: string,
  clarifications: Clarification[] = [],
): { prompt: string; clarifications: Clarification[] } {
  const trimmed = prompt.trim();
  const { prompt: budgetedPrompt, wasTrimmed } = fitPromptToBudget(trimmed);

  return {
    prompt: budgetedPrompt,
    clarifications: [
      ...clarifications,
      ...buildQualityClarifications(budgetedPrompt, {
        hasUserClarifications: clarifications.length > 0,
        wasTrimmed,
      }),
    ],
  };
}

function fitPromptToBudget(prompt: string): { prompt: string; wasTrimmed: boolean } {
  if (prompt.length <= PROMPT_MAX_CHARS) {
    return { prompt, wasTrimmed: false };
  }

  const head = prompt.slice(0, HEAD_CHARS).trimEnd();
  const tail = prompt.slice(-TAIL_CHARS).trimStart();
  return {
    prompt: `${head}\n\n${TRIM_NOTICE}\n\n${tail}`,
    wasTrimmed: true,
  };
}

function buildQualityClarifications(
  prompt: string,
  options: { hasUserClarifications: boolean; wasTrimmed: boolean },
): Clarification[] {
  const wordBudget = getOutputWordBudget(prompt);
  const structured = looksStructured(prompt);
  const domainHint = getDomainHint(prompt);

  return [
    {
      question: 'First-pass quality target',
      answer: structured
        ? 'Preserve the existing intent, task type, and structure, but tighten weak wording, remove duplication, fill obvious gaps, and make the prompt ready to use without another refinement pass.'
        : 'Make this a complete, directly usable prompt on the first attempt while preserving the requested action and deliverable. Add a clear role, task, context, constraints, output format, and success criteria when useful.',
    },
    {
      question: 'How should missing details be handled?',
      answer: 'Make practical default assumptions from the user text, but do not change the task category. Do not ask follow-up questions in the output. Use placeholders only for details that truly cannot be assumed.',
    },
    {
      question: 'Token and length budget',
      answer: `Keep the optimized prompt concise but complete, roughly ${wordBudget} words. Remove repeated instructions, avoid filler, and return only the improved prompt text.`,
    },
    {
      question: 'Domain-specific quality hints',
      answer: [
        domainHint,
        options.hasUserClarifications ? 'Respect the user-provided clarifications above these defaults.' : '',
        options.wasTrimmed ? 'The source was clipped for request size; avoid inventing details not supported by the visible text.' : '',
      ].filter(Boolean).join(' '),
    },
  ];
}

function getOutputWordBudget(prompt: string): string {
  if (prompt.length < 80) return '60-140';
  if (prompt.length < 280) return '120-260';
  if (prompt.length < 1200) return '250-550';
  return '300-700';
}

function looksStructured(prompt: string): boolean {
  return /(^|\n)\s*(role|task|objective|context|constraints?|requirements?|format|output|deliverables?)\s*[:#]/i
    .test(prompt);
}

function getDomainHint(prompt: string): string {
  const lower = prompt.toLowerCase();

  if (/\b(web|website|app|frontend|backend|full[-\s]?stack|html|css|javascript|react|next\.?js|api|database)\b/.test(lower)) {
    return 'For web/app/code tasks, include concrete deliverables, stack assumptions, responsive/accessibility expectations, file/output format, and verification criteria.';
  }

  if (/\b(email|reply|message|linkedin|cover letter|proposal|copy|content|caption|headline|section)\b/.test(lower)) {
    return 'For writing or copy tasks, preserve the requested piece of text, include audience/tone/context when helpful, and avoid turning it into analysis or a report.';
  }

  if (/\b(image|logo|design|poster|banner|ui|ux|brand)\b/.test(lower)) {
    return 'For design tasks, include style, composition, assets, dimensions if known, constraints, and quality criteria.';
  }

  if (/\b(research|analyze|summarize|compare|explain|study)\b/.test(lower)) {
    return 'For analysis tasks, include scope, method, evidence expectations, structure, and final deliverable format.';
  }

  return 'Choose the expert role and output structure from the explicit user text and any clarifications. Do not infer writing, report, OCR, or analysis work unless the user asks for it.';
}
