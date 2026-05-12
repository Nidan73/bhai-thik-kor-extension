import { API_TIMEOUT_MS, ENDPOINTS } from './constants';
import { prepareGenerateRequest } from './prompt-quality';
import type {
  GenerateResult,
  ClarifyingQuestion,
  Clarification,
  RateLimitInfo,
  ApiError,
} from './types';

// ─── Rate Limit Header Parser ───────────────────────────────────────────────────

export class ApiClientError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

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

function parseRetryAfter(response: Response, err?: ApiError): number | undefined {
  if (typeof err?.retryAfter === 'number') return err.retryAfter;

  const retryAfter = response.headers.get('Retry-After');
  if (!retryAfter) return undefined;

  const seconds = Number.parseInt(retryAfter, 10);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function friendlyErrorMessage(response: Response, err?: ApiError): string {
  if (response.status === 429) {
    return err?.error || 'You hit the rate limit. Try again in a little bit.';
  }

  if (response.status === 503) {
    return err?.error || 'Bhai Thik Kor is busy right now. Try again soon.';
  }

  if (response.status >= 500) {
    return err?.error || 'Bhai Thik Kor had a server hiccup. Try again soon.';
  }

  return err?.error || `Server error (${response.status})`;
}

async function throwIfNotOk(response: Response): Promise<void> {
  if (response.ok) return;

  const err: ApiError | undefined = await response.json().catch(() => undefined);
  throw new ApiClientError(
    friendlyErrorMessage(response, err),
    response.status,
    parseRetryAfter(response, err),
  );
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = API_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiClientError('Bhai Thik Kor took too long to respond. Try again.', 0);
    }

    throw err;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = API_TIMEOUT_MS,
): Promise<T> {
  let timeout: ReturnType<typeof globalThis.setTimeout>;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      reject(new ApiClientError('Bhai Thik Kor took too long to respond. Try again.', 0));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    globalThis.clearTimeout(timeout!);
  }
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
  const request = prepareGenerateRequest(prompt, clarifications);

  const response = await fetchWithTimeout(ENDPOINTS.generate, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  await throwIfNotOk(response);

  const rateLimit = parseRateLimit(response.headers);

  // The generate endpoint streams structured JSON via toTextStreamResponse()
  // We collect the full stream, then parse the accumulated JSON
  const rawText = await withTimeout(consumeTextStream(response));

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
  const response = await fetchWithTimeout(ENDPOINTS.clarify, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  await throwIfNotOk(response);

  return response.json();
}

// ─── Refine (Tweak It) ──────────────────────────────────────────────────────────

export async function apiRefine(
  currentPrompt: string,
  instruction: string,
): Promise<string> {
  const response = await fetchWithTimeout(ENDPOINTS.refine, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPrompt, instruction }),
  });

  await throwIfNotOk(response);

  return withTimeout(consumeTextStream(response));
}
