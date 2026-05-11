import type { Message } from './types';

/**
 * Send a typed message to the background service worker.
 * Returns the response from the message handler.
 */
export function sendToBackground<T = unknown>(message: Message): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

/**
 * Send a typed message to the active tab's content script.
 */
export async function sendToActiveTab<T = unknown>(message: Message): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return chrome.tabs.sendMessage(tab.id, message);
}

/**
 * Register a typed message handler.
 */
export function onMessage(
  handler: (
    message: Message,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | void,
) {
  chrome.runtime.onMessage.addListener(handler);
}
