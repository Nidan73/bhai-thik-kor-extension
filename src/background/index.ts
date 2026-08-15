/**
 * Background Service Worker
 *
 * Central hub for the extension:
 * - Registers context menus
 * - Handles keyboard shortcuts
 * - Routes messages between popup/content scripts
 * - Makes API calls to the Bhai Thik Kor backend
 */

import { onMessage } from '@/shared/messages';
import { ApiClientError, apiGenerate, apiClarify, apiRefine } from '@/shared/api-client';
import { PROMPT_MIN_CHARS } from '@/shared/constants';
import { appendHistory, getHistory, type HistoryEntry } from '@/shared/history';
import { inferPersonaFromHistory } from '@/shared/persona';
import { looksLikeShortImageEditCommand } from '@/shared/image-command';
import { getSettings, setSetting } from '@/shared/settings';
import type {
  AttachmentContext,
  Clarification,
  FieldType,
  ImproveSource,
  Message,
} from '@/shared/types';

type SelectedTextPayload = {
  text: string;
  fieldType: FieldType;
  isBlocked: boolean;
  attachmentContext?: AttachmentContext;
};

const PROTECTED_FIELD_MESSAGE =
  'This looks like a protected field or page. Bhai Thik Kor will not send it.';

const SENSITIVE_TAB_PATTERNS = [
  /\/login/i,
  /\/signin/i,
  /\/signup/i,
  /\/register/i,
  /\/payment/i,
  /\/checkout/i,
  /\/billing/i,
  /\/bank/i,
  /\/transfer/i,
  /\/medical/i,
  /\/health/i,
  /\/patient/i,
  /\/gov/i,
];

// ─── Context Menu Setup ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.contextMenus.create({
    id: 'improve-with-btk',
    title: 'Improve with Bhai Thik Kor',
    contexts: ['selection'],
  });

  if (details.reason !== 'install') return;

  const settings = await getSettings();
  if (settings.seenWelcome) return;

  await setSetting('seenWelcome', true);
  // The options page carries the privacy statement. Opening a tab is less
  // intrusive than injecting a notice into whatever page the user is on.
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html#privacy') });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'improve-with-btk') return;
  if (!tab?.id) return;

  if (isSensitiveTabUrl(tab.url)) {
    sendImproveErrorToTab(tab.id, PROTECTED_FIELD_MESSAGE, info.selectionText, 'context-menu');
    return;
  }

  const captured = await getSelectedTextFromTab(tab.id);
  if (captured?.isBlocked) {
    sendImproveErrorToTab(tab.id, PROTECTED_FIELD_MESSAGE, captured.text, 'context-menu');
    return;
  }

  const text = (captured?.text || info.selectionText || '').trim();
  await handleImproveRequest(text, 'context-menu', tab.id, captured?.attachmentContext);
});

// ─── Keyboard Shortcut ──────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'improve-selection') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const captured = await getSelectedTextFromTab(tab.id);
  if (!captured?.text.trim()) {
    if (tab.id) {
      sendImproveErrorToTab(tab.id, 'Focus a text box first, then use the shortcut.', '', 'shortcut');
    }
    return;
  }

  if (captured.isBlocked || isSensitiveTabUrl(tab.url)) {
    sendImproveErrorToTab(tab.id, PROTECTED_FIELD_MESSAGE, captured.text, 'shortcut');
    return;
  }

  await handleImproveRequest(captured.text.trim(), 'shortcut', tab.id, captured.attachmentContext);
});

// ─── Message Router ─────────────────────────────────────────────────────────────

onMessage((message: Message, sender, sendResponse) => {
  // Content-script senders carry a tab; the popup does not. Used to stamp a
  // hostname onto history entries.
  const senderTabId = sender.tab?.id;

  switch (message.type) {
    case 'IMPROVE_REQUEST':
      handleImproveFromMessage(
        message.payload.text,
        message.payload.source,
        sendResponse,
        message.payload.requestId,
        message.payload.attachmentContext,
        senderTabId,
      );
      return true;

    case 'CLARIFY_REQUEST':
      handleClarifyFromPopup(message.payload.text, sendResponse);
      return true;

    case 'GENERATE_WITH_CLARIFICATIONS':
      handleGenerateWithClarifications(
        message.payload.text,
        message.payload.clarifications,
        sendResponse,
        senderTabId,
      );
      return true;

    case 'REFINE_REQUEST':
      handleRefineFromPopup(
        message.payload.currentPrompt,
        message.payload.instruction,
        sendResponse,
      );
      return true;
  }
});

// ─── Handlers ───────────────────────────────────────────────────────────────────

async function resolveActivePersona(): Promise<string | undefined> {
  try {
    const settings = await getSettings();
    if (!settings.adaptiveStyleEnabled) return undefined;
    if (settings.customPersona.trim()) return settings.customPersona.trim();
    if (settings.historyEnabled) {
      const history = await getHistory();
      const inferred = inferPersonaFromHistory(history);
      return inferred?.summary;
    }
  } catch {
    // Non-critical, fallback to default
  }
  return undefined;
}

async function handleImproveFromMessage(
  text: string,
  source: ImproveSource,
  sendResponse: (response: unknown) => void,
  requestId = createRequestId(),
  attachmentContext?: AttachmentContext,
  tabId?: number,
) {
  const trimmed = text.trim();

  if (trimmed.length < PROMPT_MIN_CHARS) {
    sendResponse({
      type: 'IMPROVE_ERROR',
      payload: { error: 'Add more detail to your prompt.', originalText: trimmed, source, requestId },
    });
    return;
  }

  try {
    const persona = await resolveActivePersona();
    const { result, rateLimit } = await apiGenerate(
      trimmed,
      buildAttachmentClarifications(trimmed, attachmentContext),
      { persona },
    );
    sendResponse({
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source, requestId },
    });
    void recordHistory(trimmed, result.optimized_prompt, source, tabId);
  } catch (err) {
    sendResponse({
      type: 'IMPROVE_ERROR',
      payload: toImproveErrorPayload(err, 'Failed to improve prompt.', trimmed, source, requestId),
    });
  }
}

async function handleImproveRequest(
  text: string,
  source: ImproveSource,
  tabId: number,
  attachmentContext?: AttachmentContext,
) {
  const trimmed = text.trim();
  const requestId = createRequestId();

  if (trimmed.length < PROMPT_MIN_CHARS) {
    sendImproveErrorToTab(tabId, 'Select or write a little more text first.', trimmed, source);
    return;
  }

  chrome.tabs.sendMessage(tabId, {
    type: 'IMPROVE_STARTED',
    payload: { text: trimmed, source, requestId },
  } satisfies Message).catch(() => undefined);

  try {
    const persona = await resolveActivePersona();
    const { result, rateLimit } = await apiGenerate(
      trimmed,
      buildAttachmentClarifications(trimmed, attachmentContext),
      { persona },
    );

    chrome.tabs.sendMessage(tabId, {
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source, requestId },
    } satisfies Message).catch(() => undefined);

    void recordHistory(trimmed, result.optimized_prompt, source, tabId);
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      type: 'IMPROVE_ERROR',
      payload: toImproveErrorPayload(err, 'Failed to improve prompt.', trimmed, source, requestId),
    } satisfies Message).catch(() => undefined);
  }
}

async function handleClarifyFromPopup(
  text: string,
  sendResponse: (response: unknown) => void,
) {
  try {
    const questions = await apiClarify(text);
    sendResponse({ type: 'CLARIFY_RESPONSE', payload: { questions } });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Guided Mode unavailable.';
    sendResponse({ type: 'CLARIFY_ERROR', payload: { error } });
  }
}

async function handleGenerateWithClarifications(
  text: string,
  clarifications: Clarification[],
  sendResponse: (response: unknown) => void,
  tabId?: number,
) {
  const trimmed = text.trim();

  try {
    const persona = await resolveActivePersona();
    const { result, rateLimit } = await apiGenerate(trimmed, clarifications, { persona });
    sendResponse({
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source: 'popup' },
    });
    void recordHistory(trimmed, result.optimized_prompt, 'popup', tabId);
  } catch (err) {
    sendResponse({
      type: 'IMPROVE_ERROR',
      payload: toImproveErrorPayload(err, 'Failed to improve prompt.', trimmed, 'popup'),
    });
  }
}

async function handleRefineFromPopup(
  currentPrompt: string,
  instruction: string,
  sendResponse: (response: unknown) => void,
) {
  try {
    const refinedPrompt = await apiRefine(currentPrompt, instruction);
    sendResponse({ type: 'REFINE_RESPONSE', payload: { refinedPrompt } });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Refinement unavailable.';
    const retryAfter = err instanceof ApiClientError ? err.retryAfter : undefined;
    sendResponse({ type: 'REFINE_ERROR', payload: { error, retryAfter } });
  }
}

// ─── History ────────────────────────────────────────────────────────────────────

/**
 * The background worker sees every generate response from every surface, so it
 * is the only history writer. That rules out cross-tab races; overlapping
 * writes inside this worker are serialized by the queue in shared/history.ts.
 */
async function recordHistory(
  original: string,
  optimized: string,
  source: ImproveSource,
  tabId?: number,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.historyEnabled) return;

  const entry: HistoryEntry = {
    id: createRequestId(),
    at: Date.now(),
    original,
    optimized,
    source,
    ...(tabId === undefined ? {} : { host: await getTabHost(tabId) }),
  };

  await appendHistory(entry);
}

async function getTabHost(tabId: number): Promise<string | undefined> {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ? new URL(tab.url).hostname : undefined;
  } catch {
    return undefined;
  }
}

// ─── Tab Helpers ────────────────────────────────────────────────────────────────

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch {
    // Already injected, or the page does not allow content scripts.
  }
}

async function getSelectedTextFromTab(tabId: number): Promise<SelectedTextPayload | null> {
  const existing = await requestSelectedTextFromTab(tabId);
  if (existing) return existing;

  await ensureContentScript(tabId);
  return requestSelectedTextFromTab(tabId);
}

async function requestSelectedTextFromTab(tabId: number): Promise<SelectedTextPayload | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: 'GET_SELECTED_TEXT',
    } satisfies Message);

    if (response?.type === 'SELECTED_TEXT_RESULT') {
      return response.payload;
    }
  } catch {
    // The content script is unavailable on Chrome pages and some restricted URLs.
  }

  return null;
}

function sendImproveErrorToTab(
  tabId: number,
  error: string,
  originalText: string | undefined,
  source: ImproveSource,
) {
  chrome.tabs.sendMessage(tabId, {
    type: 'IMPROVE_ERROR',
    payload: { error, originalText, source },
  } satisfies Message).catch(() => undefined);
}

function isSensitiveTabUrl(url?: string): boolean {
  if (!url) return false;
  return SENSITIVE_TAB_PATTERNS.some(pattern => pattern.test(url));
}

function toImproveErrorPayload(
  err: unknown,
  fallback: string,
  originalText: string,
  source: ImproveSource,
  requestId?: string,
) {
  return {
    error: err instanceof Error ? err.message : fallback,
    retryAfter: err instanceof ApiClientError ? err.retryAfter : undefined,
    originalText,
    source,
    requestId,
  };
}

function buildAttachmentClarifications(
  prompt: string,
  attachmentContext?: AttachmentContext,
): Clarification[] {
  if (!attachmentContext || attachmentContext.count < 1) return [];

  const attachmentNoun = attachmentContext.count === 1 ? 'attachment' : 'attachments';
  const summary = attachmentContext.summary || `${attachmentContext.count} attached item(s)`;
  const selectedTask = clipForClarification(prompt);
  const shortImageEditHint = buildShortImageEditHint(prompt, attachmentContext);

  return [
    {
      question: 'Attached file context from the current text box',
      answer: [
        `The current composer has ${summary}.`,
        `Preserve the selected task exactly: "${selectedTask}".`,
        shortImageEditHint,
        `Mention the attached ${attachmentNoun} only as reference/context for that same task.`,
        'Do not turn the request into image analysis, comparison, recommendations, extraction, or a report unless the selected text explicitly asks for that.',
        'Do not claim the extension inspected the attachment contents.',
        'For vague references like "this", "this section", or "the image", point the final prompt at the attached item while keeping the original deliverable.',
      ].filter(Boolean).join(' '),
    },
  ];
}

function buildShortImageEditHint(
  prompt: string,
  attachmentContext: AttachmentContext,
): string {
  if (!attachmentContext.kinds.includes('image')) return '';
  if (!looksLikeShortImageEditCommand(prompt)) return '';

  return [
    'This is a short command referring to the attached image itself.',
    'Interpret "it" or "this" as the attached image, not as text inside the image.',
    'Generate an image-improvement/editing prompt: improve visual quality, clarity, lighting, composition, sharpness, and overall appeal while preserving the real scene and important details.',
    'Do not make the role a copy editor, report writer, OCR extractor, or text improver.',
  ].join(' ');
}

function clipForClarification(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length <= 140 ? singleLine : `${singleLine.slice(0, 137)}...`;
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
