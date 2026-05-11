/**
 * Background Service Worker
 *
 * Central hub for the extension:
 * - Registers context menus
 * - Handles keyboard shortcuts
 * - Routes messages between popup and content scripts
 * - Makes API calls to the Bhai Thik Kor backend
 */

import { onMessage, sendToActiveTab } from '@/shared/messages';
import { apiGenerate, apiClarify, apiRefine } from '@/shared/api-client';
import { PROMPT_MIN_CHARS } from '@/shared/constants';
import type { Message, Clarification } from '@/shared/types';

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
  if (!info.selectionText?.trim()) return;
  if (!tab?.id) return;

  const text = info.selectionText.trim();
  await handleImproveRequest(text, 'context-menu', tab.id);
});

// ─── Keyboard Shortcut ──────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'improve-selection') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Inject content script if not already present, then request selected text
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch {
    // Content script may already be injected, ignore
  }

  try {
    const response = await sendToActiveTab<{ text: string; fieldType: string; isBlocked: boolean }>({
      type: 'GET_SELECTED_TEXT',
    });

    if (response?.text?.trim()) {
      await handleImproveRequest(response.text.trim(), 'shortcut', tab.id);
    }
  } catch (err) {
    console.warn('Could not get selected text:', err);
  }
});

// ─── Message Router ─────────────────────────────────────────────────────────────

onMessage((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'IMPROVE_REQUEST':
      handleImproveFromPopup(message.payload.text, sendResponse);
      return true; // async response

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

async function handleImproveFromPopup(
  text: string,
  sendResponse: (response: unknown) => void,
) {
  if (text.length < PROMPT_MIN_CHARS) {
    sendResponse({ type: 'IMPROVE_ERROR', payload: { error: 'Add more detail to your prompt.' } });
    return;
  }

  try {
    const { result, rateLimit } = await apiGenerate(text);
    sendResponse({ type: 'IMPROVE_RESPONSE', payload: { result, rateLimit } });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed to improve prompt.';
    sendResponse({ type: 'IMPROVE_ERROR', payload: { error } });
  }
}

async function handleImproveRequest(text: string, source: string, tabId: number) {
  if (text.length < PROMPT_MIN_CHARS) return;

  try {
    const { result, rateLimit } = await apiGenerate(text);

    // Send result back to content script for overlay display
    chrome.tabs.sendMessage(tabId, {
      type: 'IMPROVE_RESPONSE',
      payload: { result, rateLimit },
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed to improve prompt.';
    chrome.tabs.sendMessage(tabId, {
      type: 'IMPROVE_ERROR',
      payload: { error },
    });
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
  try {
    const { result, rateLimit } = await apiGenerate(text, clarifications);
    sendResponse({ type: 'IMPROVE_RESPONSE', payload: { result, rateLimit } });
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Failed to improve prompt.';
    sendResponse({ type: 'IMPROVE_ERROR', payload: { error } });
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
    sendResponse({ type: 'REFINE_ERROR', payload: { error } });
  }
}
