import type { HistoryEntry } from './history';

// ─── Keyword Sets for Domain Inference ──────────────────────────────────────────

const DEV_KEYWORDS = [
  'react', 'nextjs', 'next.js', 'typescript', 'javascript', 'python', 'api',
  'sql', 'backend', 'frontend', 'css', 'html', 'node', 'docker', 'rust', 'go',
  'function', 'component', 'database', 'tailwind', 'git', 'debug', 'bug', 'endpoint',
  'graphql', 'vue', 'svelte', 'django', 'fastapi', 'prisma', 'postgres', 'redis',
];

const WRITING_KEYWORDS = [
  'email', 'linkedin', 'post', 'caption', 'blog', 'article', 'copy', 'headline',
  'newsletter', 'sales', 'pitch', 'resume', 'cover letter', 'announcement', 'reply',
];

const DESIGN_KEYWORDS = [
  'ui', 'ux', 'figma', 'logo', 'layout', 'typography', 'branding', 'wireframe',
  'palette', 'hero section', 'landing page design',
];

const RESEARCH_KEYWORDS = [
  'summary', 'research', 'paper', 'compare', 'analysis', 'study', 'benchmark',
  'literature', 'survey', 'pros and cons',
];

// ─── Pure Inference Logic ───────────────────────────────────────────────────────

export type InferredPersona = {
  role?: string;
  stack?: string[];
  tone?: string;
  summary: string;
};

/**
 * Pure heuristic that scans local history entries to infer the user's primary
 * domain, tech stack, and tone preferences. Returns null if there are fewer
 * than 2 entries or no clear signal.
 */
export function inferPersonaFromHistory(entries: HistoryEntry[]): InferredPersona | null {
  if (!entries || entries.length < 2) return null;

  // Combine text from recent prompts (newest 20 max)
  const sample = entries.slice(0, 20);
  const fullText = sample.map(e => e.original.toLowerCase()).join(' ');

  // Count domain hits
  let devHits = 0;
  let writingHits = 0;
  let designHits = 0;
  let researchHits = 0;

  const foundTech: string[] = [];

  for (const kw of DEV_KEYWORDS) {
    if (fullText.includes(kw)) {
      devHits++;
      // Keep well-known tech names formatted nicely
      if (['react', 'next.js', 'typescript', 'python', 'tailwind', 'docker', 'rust', 'go', 'vue', 'django', 'fastapi'].includes(kw)) {
        foundTech.push(kw.charAt(0).toUpperCase() + kw.slice(1));
      }
    }
  }

  for (const kw of WRITING_KEYWORDS) {
    if (fullText.includes(kw)) writingHits++;
  }

  for (const kw of DESIGN_KEYWORDS) {
    if (fullText.includes(kw)) designHits++;
  }

  for (const kw of RESEARCH_KEYWORDS) {
    if (fullText.includes(kw)) researchHits++;
  }

  const maxHits = Math.max(devHits, writingHits, designHits, researchHits);
  if (maxHits === 0) return null;

  let role = 'General User';
  let stackSummary = '';

  if (maxHits === devHits && devHits >= 2) {
    role = 'Software Developer';
    if (foundTech.length > 0) {
      const topStack = Array.from(new Set(foundTech)).slice(0, 4);
      stackSummary = topStack.join(', ');
    }
  } else if (maxHits === writingHits && writingHits >= 2) {
    role = 'Writer & Communicator';
  } else if (maxHits === designHits && designHits >= 2) {
    role = 'UI/UX Designer';
  } else if (maxHits === researchHits && researchHits >= 2) {
    role = 'Researcher & Analyst';
  }

  // Detect brevity / tone preference
  const avgLength = sample.reduce((sum, e) => sum + e.original.length, 0) / sample.length;
  const tone = avgLength < 80 ? 'concise, direct, code-first' : 'clear and well-structured';

  const parts = [
    `Role: ${role}`,
    stackSummary ? `Preferred stack: ${stackSummary}` : '',
    `Tone: ${tone}`,
  ].filter(Boolean);

  return {
    role,
    stack: foundTech.length > 0 ? foundTech : undefined,
    tone,
    summary: parts.join(' | '),
  };
}
