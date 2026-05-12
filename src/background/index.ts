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

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'improve-with-btk',
    title: 'Improve with Bhai Thik Kor',
    contexts: ['selection'],
  });
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

onMessage((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'IMPROVE_REQUEST':
      handleImproveFromMessage(
        message.payload.text,
        message.payload.source,
        sendResponse,
        message.payload.requestId,
        message.payload.attachmentContext,
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

async function handleImproveFromMessage(
  text: string,
  source: ImproveSource,
  sendResponse: (response: unknown) => void,
  requestId = createRequestId(),
  attachmentContext?: AttachmentContext,
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
    const { result, rateLimit } = await apiGenerate(
      trimmed,
      buildAttachmentClarifications(attachmentContext),
    );
    sendResponse({
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source, requestId },
    });
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
    const { result, rateLimit } = await apiGenerate(
      trimmed,
      buildAttachmentClarifications(attachmentContext),
    );

    chrome.tabs.sendMessage(tabId, {
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source, requestId },
    } satisfies Message).catch(() => undefined);
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
) {
  const trimmed = text.trim();

  try {
    const { result, rateLimit } = await apiGenerate(trimmed, clarifications);
    sendResponse({
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit, originalText: trimmed, source: 'popup' },
    });
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
  attachmentContext?: AttachmentContext,
): Clarification[] {
  if (!attachmentContext || attachmentContext.count < 1) return [];

  const attachmentNoun = attachmentContext.count === 1 ? 'attachment' : 'attachments';
  const summary = attachmentContext.summary || `${attachmentContext.count} attached item(s)`;

  return [
    {
      question: 'Attached file context from the current text box',
      answer: [
        `The user has ${summary} in the same composer as the prompt.`,
        `The optimized prompt should explicitly tell the target AI to use the attached ${attachmentNoun} as context.`,
        'Do not claim to have inspected the attachment contents; only preserve and clarify that the attachment should be used when the user sends the prompt.',
        'If the prompt says "this", "this section", "the image", or similar, resolve that reference to the attached item.',
      ].join(' '),
    },
  ];
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
