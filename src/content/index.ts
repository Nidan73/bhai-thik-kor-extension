/**
 * Content Script
 *
 * Runs in the context of web pages. Responsible for:
 * - Capturing selected text or active input text
 * - Detecting and skipping sensitive fields
 * - Replacing or inserting text into page fields
 * - Rendering the suggestion overlay (Shadow DOM)
 */

import type { FieldType, Message } from '@/shared/types';

// ─── Sensitive Field Guards ─────────────────────────────────────────────────────

const BLOCKED_INPUT_TYPES = new Set(['password', 'hidden']);

const BLOCKED_AUTOCOMPLETE = new Set([
  'cc-number', 'cc-exp', 'cc-csc', 'cc-name', 'cc-type',
  'one-time-code', 'current-password', 'new-password',
  'transaction-amount', 'transaction-currency',
]);

const SENSITIVE_URL_PATTERNS = [
  /\/login/i, /\/signin/i, /\/signup/i, /\/register/i,
  /\/payment/i, /\/checkout/i, /\/billing/i,
  /\/bank/i, /\/transfer/i,
];

function isFieldBlocked(el: HTMLElement): boolean {
  // Skip password and hidden inputs
  if (el instanceof HTMLInputElement) {
    if (BLOCKED_INPUT_TYPES.has(el.type)) return true;
    if (el.disabled || el.readOnly) return true;
    if (BLOCKED_AUTOCOMPLETE.has(el.autocomplete || '')) return true;
  }

  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return true;
  }

  // Skip fields inside suspicious forms
  const form = el.closest('form');
  if (form) {
    const action = (form.action || '').toLowerCase();
    if (SENSITIVE_URL_PATTERNS.some(p => p.test(action))) return true;
  }

  // Skip sensitive pages
  const url = window.location.href;
  if (SENSITIVE_URL_PATTERNS.some(p => p.test(url))) return true;

  return false;
}

// ─── Text Capture ───────────────────────────────────────────────────────────────

function getFieldType(el: Element | null): FieldType {
  if (!el) return 'unknown';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement) return 'input';
  if ((el as HTMLElement).isContentEditable) return 'contenteditable';
  return 'unknown';
}

function getSelectedText(): { text: string; fieldType: FieldType; isBlocked: boolean } {
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() || '';

  if (selectedText) {
    const anchorNode = selection?.anchorNode;
    const el = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
    const fieldType = getFieldType(el);
    const isBlocked = el ? isFieldBlocked(el) : false;
    return { text: selectedText, fieldType, isBlocked };
  }

  // No selection — try active element
  const active = document.activeElement;
  if (!active) return { text: '', fieldType: 'unknown', isBlocked: false };

  const fieldType = getFieldType(active);
  const isBlocked = isFieldBlocked(active as HTMLElement);

  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    return { text: active.value.trim(), fieldType, isBlocked };
  }

  if ((active as HTMLElement).isContentEditable) {
    return { text: (active as HTMLElement).innerText.trim(), fieldType, isBlocked };
  }

  return { text: '', fieldType: 'unknown', isBlocked: false };
}

// ─── Text Actions (Replace / Insert Below) ──────────────────────────────────────

function replaceText(newText: string): boolean {
  const selection = window.getSelection();

  // Try replacing selected text first
  if (selection && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const el = container instanceof HTMLElement ? container : container.parentElement;

    if (el && isFieldBlocked(el)) return false;

    // For contentEditable
    if (el?.isContentEditable) {
      range.deleteContents();
      range.insertNode(document.createTextNode(newText));
      selection.collapseToEnd();
      // Dispatch input event so frameworks (React, Vue) pick up the change
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  }

  // Try replacing active input/textarea value
  const active = document.activeElement;
  if (active && isFieldBlocked(active as HTMLElement)) return false;

  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    active.value = newText;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    active.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  if ((active as HTMLElement)?.isContentEditable) {
    (active as HTMLElement).innerText = newText;
    (active as HTMLElement).dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  return false;
}

function insertBelow(newText: string): boolean {
  const active = document.activeElement;
  if (!active) return false;
  if (isFieldBlocked(active as HTMLElement)) return false;

  if (active instanceof HTMLTextAreaElement) {
    const current = active.value;
    const separator = current.endsWith('\n') ? '' : '\n\n';
    active.value = current + separator + newText;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  if (active instanceof HTMLInputElement) {
    // For single-line inputs, append with a separator
    active.value = active.value + ' | ' + newText;
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  if ((active as HTMLElement).isContentEditable) {
    const el = active as HTMLElement;
    const br = document.createElement('br');
    const textNode = document.createTextNode(newText);
    el.appendChild(br);
    el.appendChild(br.cloneNode());
    el.appendChild(textNode);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  return false;
}

// ─── Message Listener ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, _sender, sendResponse) => {
    switch (message.type) {
      case 'GET_SELECTED_TEXT': {
        const result = getSelectedText();
        sendResponse({ type: 'SELECTED_TEXT_RESULT', payload: result });
        return false;
      }

      case 'REPLACE_TEXT': {
        const success = replaceText(message.payload.text);
        sendResponse({ type: 'ACTION_DONE', payload: { success } });
        return false;
      }

      case 'INSERT_BELOW': {
        const success = insertBelow(message.payload.text);
        sendResponse({ type: 'ACTION_DONE', payload: { success } });
        return false;
      }

      case 'IMPROVE_RESPONSE':
      case 'IMPROVE_ERROR': {
        // These will be handled by the overlay in future phases
        // For now, log to confirm messages are received
        console.log('[BTK Content] Received:', message.type);
        return false;
      }
    }
  },
);
