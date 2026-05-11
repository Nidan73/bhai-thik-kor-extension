import { ENDPOINTS } from './constants';
import type {
  GenerateResult,
  ClarifyingQuestion,
  Clarification,
  RateLimitInfo,
  ApiError,
} from './types';

// ─── Rate Limit Header Parser ───────────────────────────────────────────────────

function parseRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get('X-RateLimit-Limit');
  const remaining = headers.get('X-RateLimit-Remaining');
  const reset = headers.get('X-RateLimit-Reset');

  if (limit && remaining && reset) {
    return {
      limit: parseInt(limit, 10),
      remaining: parseInt(remaining, 10),
      resetAt: parseInt(reset, 10),
    };
  }
  return undefined;
}

// ─── Stream Parser for streamObject/streamText ──────────────────────────────────

/**
 * Parse a Vercel AI SDK text stream response and collect the full text.
 * The AI SDK toTextStreamResponse() sends chunks as plain text (not SSE).
 */
async function consumeTextStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let result = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }

  return result;
}

// ─── Generate (Normal Mode) ─────────────────────────────────────────────────────

export async function apiGenerate(
  prompt: string,
  clarifications: Clarification[] = [],
): Promise<{ result: GenerateResult; rateLimit?: RateLimitInfo }> {
  const response = await fetch(ENDPOINTS.generate, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, clarifications }),
  });

  if (!response.ok) {
    const err: ApiError = await response.json().catch(() => ({
      error: `Server error (${response.status})`,
    }));
    throw new Error(err.error);
  }

  const rateLimit = parseRateLimit(response.headers);

  // The generate endpoint streams structured JSON via toTextStreamResponse()
  // We collect the full stream, then parse the accumulated JSON
  const rawText = await consumeTextStream(response);

  // The streamed text is the raw JSON object
  let result: GenerateResult;
  try {
    result = JSON.parse(rawText);
  } catch {
    // Sometimes the stream includes partial/incremental tokens
    // Try to extract the last complete JSON object
    const lastBrace = rawText.lastIndexOf('}');
    const firstBrace = rawText.indexOf('{');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      result = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
    } else {
      throw new Error('Failed to parse AI response');
    }
  }

  return { result, rateLimit };
}

// ─── Clarify (Guided Mode) ──────────────────────────────────────────────────────

export async function apiClarify(prompt: string): Promise<ClarifyingQuestion[]> {
  const response = await fetch(ENDPOINTS.clarify, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  if (!response.ok) {
    const err: ApiError = await response.json().catch(() => ({
      error: `Server error (${response.status})`,
    }));
    throw new Error(err.error);
  }

  return response.json();
}

// ─── Refine (Tweak It) ──────────────────────────────────────────────────────────

export async function apiRefine(
  currentPrompt: string,
  instruction: string,
): Promise<string> {
  const response = await fetch(ENDPOINTS.refine, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPrompt, instruction }),
  });

  if (!response.ok) {
    const err: ApiError = await response.json().catch(() => ({
      error: `Server error (${response.status})`,
    }));
    throw new Error(err.error);
  }

  return consumeTextStream(response);
}
