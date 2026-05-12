/**
 * Content Script
 *
 * Runs in web pages. It captures user-approved text, avoids sensitive fields,
 * renders the in-page suggestion UI, and applies replace/insert actions.
 */

import type {
  AttachmentContext,
  AttachmentKind,
  Clarification,
  ClarifyingQuestion,
  FieldType,
  GenerateResult,
  ImproveSource,
  Message,
} from '@/shared/types';

const PROMPT_MIN_CHARS = 3;
const WEBSITE_URL = 'https://bhaithikkor.vercel.app';
const CONTENT_STATE_KEY = '__btkContentState';
const IMPROVE_TIMEOUT_MS = 50000;

type ContentState = {
  controller: AbortController;
};

const globalState = globalThis as typeof globalThis & {
  [CONTENT_STATE_KEY]?: ContentState;
};

globalState[CONTENT_STATE_KEY]?.controller.abort();
const contentController = new AbortController();
globalState[CONTENT_STATE_KEY] = { controller: contentController };
cleanupTransientUi();

function buildWebsiteUrl(_prompt?: string, platformId?: string, mode?: 'normal' | 'guided'): string {
  const url = new URL(WEBSITE_URL);
  url.searchParams.set('source', 'extension');

  if (platformId?.trim()) {
    url.searchParams.set('platform', platformId.trim());
  }

  if (mode) {
    url.searchParams.set('mode', mode);
  }

  return url.toString();
}

type TextSnapshot = {
  text: string;
  fieldType: FieldType;
  isBlocked: boolean;
  attachmentContext?: AttachmentContext;
};

const BLOCKED_INPUT_TYPES = new Set(['password', 'hidden']);

const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'email',
  'tel',
]);

const BLOCKED_AUTOCOMPLETE = new Set([
  'cc-number',
  'cc-exp',
  'cc-csc',
  'cc-name',
  'cc-type',
  'one-time-code',
  'current-password',
  'new-password',
  'transaction-amount',
  'transaction-currency',
]);

const SENSITIVE_URL_PATTERNS = [
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

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /passcode/i,
  /\botp\b/i,
  /one[-_\s]?time/i,
  /credit/i,
  /card/i,
  /\bcc\b/i,
  /cvc/i,
  /cvv/i,
  /ssn/i,
  /social[-_\s]?security/i,
  /routing/i,
  /account[-_\s]?number/i,
  /iban/i,
  /bank/i,
  /medical/i,
  /patient/i,
];

const PROMPT_WORDS = [
  'write',
  'create',
  'make',
  'fix',
  'explain',
  'summarize',
  'generate',
  'plan',
  'design',
  'code',
  'improve',
  'draft',
  'email',
  'prompt',
];

const AI_WORKFLOW_DOMAINS = [
  /chatgpt\.com/i,
  /claude\.ai/i,
  /gemini\.google\.com/i,
  /notion\.so/i,
  /mail\.google\.com/i,
  /linkedin\.com/i,
];

const ATTACHMENT_ELEMENT_SELECTOR = [
  'img[src^="blob:"]',
  'img[src^="data:image"]',
  'img[alt*="attached" i]',
  'img[alt*="attachment" i]',
  'img[alt*="uploaded" i]',
  'img[alt*="preview" i]',
  'video[src^="blob:"]',
  'audio[src^="blob:"]',
  'a[href^="blob:"]',
  'input[type="file"]',
  '[data-file-id]',
  '[data-file-name]',
  '[data-filename]',
  '[data-testid*="attachment" i]',
  '[data-testid*="attached" i]',
  '[data-testid*="file-preview" i]',
  '[data-testid*="filepreview" i]',
  '[data-testid*="image-preview" i]',
  '[data-testid*="upload-preview" i]',
  '[aria-label*="attached" i]',
  '[aria-label*="attachment" i]',
  '[aria-label*="uploaded" i]',
  '[aria-label*="remove" i]',
  '[aria-label*="remove file" i]',
  '[aria-label*="remove image" i]',
  '[aria-label*="remove attachment" i]',
  '[title*="attached" i]',
  '[title*="attachment" i]',
  '[title*="uploaded" i]',
].join(',');

const ATTACHMENT_CARD_SELECTOR = [
  '[data-file-id]',
  '[data-file-name]',
  '[data-filename]',
  '[data-testid*="attachment" i]',
  '[data-testid*="attached" i]',
  '[data-testid*="file-preview" i]',
  '[data-testid*="filepreview" i]',
  '[data-testid*="image-preview" i]',
  '[data-testid*="upload-preview" i]',
  '[aria-label*="attached" i]',
  '[aria-label*="attachment" i]',
  '[aria-label*="uploaded" i]',
  'figure',
  '[role="listitem"]',
].join(',');

const ATTACHMENT_EVIDENCE_PATTERN =
  /\b(attached|attachment|uploaded|remove (?:file|image|attachment)|file[-_\s]?preview|image[-_\s]?preview|upload[-_\s]?preview|screenshot)\b|\.(png|jpe?g|webp|gif|svg|heic|pdf|docx?|xlsx?|pptx?|csv|txt|zip|json|mp4|mov|webm|mp3|wav)\b/i;

const UPLOAD_ONLY_PATTERN =
  /\b(upload|attach|add file|choose file|browse files?|select files?)\b/i;

let overlayHost: HTMLDivElement | null = null;
let floatingHost: HTMLDivElement | null = null;
let toastHost: HTMLDivElement | null = null;
let lastActiveEditable: HTMLElement | null = null;
let lastCaptureTarget: HTMLElement | null = null;
let lastSelectionRange: Range | null = null;
let lastInputSelection:
  | { target: HTMLInputElement | HTMLTextAreaElement; start: number; end: number }
  | null = null;
let floatingTimer: number | undefined;
let busyRecoveryTimer: number | undefined;
let activeImproveRequestId: string | null = null;
const ignoredImproveRequestIds = new Set<string>();
let busyState:
  | {
      target: HTMLElement;
      visualTarget: HTMLElement;
      previousReadOnly?: boolean;
      previousContentEditable?: string | null;
      previousAriaBusy?: string | null;
      previousStyle: {
        opacity: string;
        filter: string;
        cursor: string;
        pointerEvents: string;
        outline: string;
        boxShadow: string;
      };
    }
  | null = null;

// ─── Sensitive Field Guards ─────────────────────────────────────────────────────

function isFieldBlocked(el: HTMLElement): boolean {
  if (isSensitiveUrl(window.location.href)) return true;

  if (el instanceof HTMLInputElement) {
    if (BLOCKED_INPUT_TYPES.has(el.type)) return true;
    if (!TEXT_INPUT_TYPES.has(el.type)) return true;
    if (el.disabled || el.readOnly) return true;
    if (BLOCKED_AUTOCOMPLETE.has(el.autocomplete || '')) return true;
  }

  if (el instanceof HTMLTextAreaElement) {
    if (el.disabled || el.readOnly) return true;
    if (BLOCKED_AUTOCOMPLETE.has(el.autocomplete || '')) return true;
  }

  const attrBlob = [
    el.getAttribute('id'),
    el.getAttribute('name'),
    el.getAttribute('placeholder'),
    el.getAttribute('aria-label'),
    el.getAttribute('autocomplete'),
    el.getAttribute('data-testid'),
  ].filter(Boolean).join(' ');

  if (SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(attrBlob))) {
    return true;
  }

  const form = el.closest('form');
  if (form) {
    const formBlob = [
      form.action,
      form.getAttribute('id'),
      form.getAttribute('name'),
      form.getAttribute('aria-label'),
    ].filter(Boolean).join(' ');

    if (SENSITIVE_URL_PATTERNS.some(pattern => pattern.test(formBlob))) {
      return true;
    }
  }

  return false;
}

function isSensitiveUrl(url: string): boolean {
  return SENSITIVE_URL_PATTERNS.some(pattern => pattern.test(url));
}

// ─── Text Capture ───────────────────────────────────────────────────────────────

function isEditableElement(el: Element | null): el is HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

function closestEditable(el: Element | null): HTMLElement | null {
  if (!el) return null;
  const candidate = el.closest('textarea,input,[contenteditable]');
  return isEditableElement(candidate) ? candidate : null;
}

function getFieldType(el: Element | null): FieldType {
  if (!el) return 'unknown';
  if (el instanceof HTMLTextAreaElement) return 'textarea';
  if (el instanceof HTMLInputElement) return 'input';
  if ((el as HTMLElement).isContentEditable) return 'contenteditable';
  return 'unknown';
}

function getEditableText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    return el.value;
  }

  return el.innerText;
}

function getActiveEditable(): HTMLElement | null {
  return isEditableElement(document.activeElement) ? document.activeElement : null;
}

function getSelectionEditable(): HTMLElement | null {
  const selection = window.getSelection();
  const anchorNode = selection?.anchorNode;
  const anchorElement =
    anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
  return closestEditable(anchorElement);
}

function getInputSelectionText(el: HTMLInputElement | HTMLTextAreaElement): string {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  return start !== end ? el.value.slice(start, end) : '';
}

function buildTextSnapshot(
  text: string,
  target: HTMLElement | null,
  isBlocked: boolean,
): TextSnapshot {
  const attachmentContext = detectAttachmentContext(target);

  return {
    text,
    fieldType: getFieldType(target),
    isBlocked,
    ...(attachmentContext ? { attachmentContext } : {}),
  };
}

function getSelectedText(): TextSnapshot {
  const active = getActiveEditable();

  if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    const selectedInputText = getInputSelectionText(active).trim();
    if (selectedInputText) {
      lastActiveEditable = active;
      lastCaptureTarget = active;
      lastInputSelection = { target: active, start, end };
      return buildTextSnapshot(selectedInputText, active, isFieldBlocked(active));
    }
  }

  const selection = window.getSelection();
  const selectedText = selection?.toString().trim() || '';

  if (selectedText) {
    const editable = getSelectionEditable();
    if (selection && selection.rangeCount > 0) {
      lastSelectionRange = selection.getRangeAt(0).cloneRange();
    }
    lastCaptureTarget = editable;

    return buildTextSnapshot(
      selectedText,
      editable ?? lastActiveEditable,
      editable ? isFieldBlocked(editable) : isSensitiveUrl(window.location.href),
    );
  }

  if (active) {
    lastActiveEditable = active;
    lastCaptureTarget = active;
    lastInputSelection = null;
    return buildTextSnapshot(getEditableText(active).trim(), active, isFieldBlocked(active));
  }

  if (lastActiveEditable && document.contains(lastActiveEditable)) {
    lastCaptureTarget = lastActiveEditable;
    lastInputSelection = null;
    return buildTextSnapshot(
      getEditableText(lastActiveEditable).trim(),
      lastActiveEditable,
      isFieldBlocked(lastActiveEditable),
    );
  }

  return { text: '', fieldType: 'unknown', isBlocked: isSensitiveUrl(window.location.href) };
}

// ─── Text Actions (Replace / Insert Below) ──────────────────────────────────────

function detectAttachmentContext(target: HTMLElement | null): AttachmentContext | undefined {
  const root = getAttachmentSearchRoot(target);
  if (!root) return undefined;

  const attachments = collectAttachmentElements(root);
  if (!attachments.length) return undefined;

  const kinds = attachments.map(inferAttachmentKind);

  return {
    count: attachments.length,
    kinds: uniqueAttachmentKinds(kinds),
    summary: formatAttachmentSummary(kinds),
  };
}

function getAttachmentSearchRoot(target: HTMLElement | null): HTMLElement | null {
  const anchor =
    target ??
    getActiveEditable() ??
    (lastCaptureTarget && document.contains(lastCaptureTarget) ? lastCaptureTarget : null) ??
    (lastActiveEditable && document.contains(lastActiveEditable) ? lastActiveEditable : null);

  if (!anchor || !document.contains(anchor)) return null;

  const form = anchor.closest('form');
  if (form instanceof HTMLElement && isUsableVisualContainer(form, anchor)) {
    return form;
  }

  const visual = getVisualContainer(anchor);
  if (visual !== anchor) return visual;

  return anchor.parentElement ?? anchor;
}

function collectAttachmentElements(root: HTMLElement): HTMLElement[] {
  const normalized = new Set<HTMLElement>();

  for (const element of queryAttachmentElements(root)) {
    if (!isAttachmentEvidenceElement(element, root)) continue;

    const attachmentElement = getAttachmentElementKey(element, root);
    normalized.add(attachmentElement);

    if (normalized.size >= 5) break;
  }

  return Array.from(normalized);
}

function queryAttachmentElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];

  if (matchesSelector(root, ATTACHMENT_ELEMENT_SELECTOR)) {
    elements.push(root);
  }

  try {
    root.querySelectorAll(ATTACHMENT_ELEMENT_SELECTOR).forEach((element) => {
      if (element instanceof HTMLElement) elements.push(element);
    });
  } catch {
    root.querySelectorAll('img,video,audio,a,input[type="file"],button,[aria-label],[title]').forEach(
      (element) => {
        if (element instanceof HTMLElement) elements.push(element);
      },
    );
  }

  return elements;
}

function isAttachmentEvidenceElement(element: HTMLElement, root: HTMLElement): boolean {
  if (element.closest('#btk-floating-root, #btk-overlay-root, #btk-toast-root')) return false;

  if (element instanceof HTMLInputElement && element.type === 'file') {
    return Boolean(element.files?.length) && isVisibleElement(element);
  }

  if (hasBlobMedia(element)) {
    return isVisibleElement(element);
  }

  if (!isVisibleElement(element)) return false;

  const blob = getAttachmentTextBlob(element);
  if (!ATTACHMENT_EVIDENCE_PATTERN.test(blob)) return false;

  const rootRect = root.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const looksLikeWholeComposer =
    rect.width >= rootRect.width * 0.92 &&
    rect.height >= Math.min(rootRect.height * 0.75, 220);

  if (looksLikeWholeComposer) return false;

  const hasStrongEvidence =
    /\b(attached|attachment|uploaded|remove (?:file|image|attachment)|file[-_\s]?preview|image[-_\s]?preview|upload[-_\s]?preview)\b/i.test(blob) ||
    /\.(png|jpe?g|webp|gif|svg|heic|pdf|docx?|xlsx?|pptx?|csv|txt|zip|json|mp4|mov|webm|mp3|wav)\b/i.test(blob);

  return hasStrongEvidence || !UPLOAD_ONLY_PATTERN.test(blob);
}

function getAttachmentElementKey(element: HTMLElement, root: HTMLElement): HTMLElement {
  const previewGroup = closestAttachmentPreviewGroup(element, root);
  if (previewGroup) return previewGroup;

  const card = closestAttachmentCard(element, root);
  if (card) return card;

  return element;
}

function closestAttachmentPreviewGroup(
  element: HTMLElement,
  root: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;

  while (current && current !== root) {
    if (
      isReasonableAttachmentCard(current, root) &&
      hasAttachmentPreviewMedia(current) &&
      hasAttachmentPreviewEvidence(current)
    ) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function hasAttachmentPreviewMedia(element: HTMLElement): boolean {
  if (hasBlobMedia(element)) return true;

  return Boolean(
    element.querySelector(
      'img[alt*="attached" i],img[alt*="attachment" i],img[alt*="uploaded" i],img[alt*="preview" i]',
    ),
  );
}

function hasAttachmentPreviewEvidence(element: HTMLElement): boolean {
  const blob = getAttachmentTextBlob(element);
  if (ATTACHMENT_EVIDENCE_PATTERN.test(blob)) return true;

  return Boolean(
    element.querySelector(
      '[aria-label*="remove" i],[aria-label*="attached" i],[aria-label*="attachment" i],[title*="attached" i],[title*="attachment" i]',
    ),
  );
}

function closestAttachmentCard(element: HTMLElement, root: HTMLElement): HTMLElement | null {
  const card = closestWithinRoot(element, ATTACHMENT_CARD_SELECTOR, root);
  if (card && card !== root && isReasonableAttachmentCard(card, root)) {
    return card;
  }

  return null;
}

function closestWithinRoot(
  element: HTMLElement,
  selector: string,
  root: HTMLElement,
): HTMLElement | null {
  let current: HTMLElement | null = element;

  while (current && current !== root) {
    if (matchesSelector(current, selector)) return current;
    current = current.parentElement;
  }

  return null;
}

function isReasonableAttachmentCard(element: HTMLElement, root: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();

  if (rect.width < 8 || rect.height < 8) return false;
  if (rect.width > rootRect.width * 0.98 && rect.height > 180) return false;
  if (rect.height > Math.max(240, rootRect.height * 0.7)) return false;

  return true;
}

function matchesSelector(element: HTMLElement, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

function isVisibleElement(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 1 &&
    rect.height > 1 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none' &&
    Number(style.opacity || '1') > 0
  );
}

function hasBlobMedia(element: HTMLElement): boolean {
  if (element instanceof HTMLImageElement) {
    return element.src.startsWith('blob:') || element.src.startsWith('data:image');
  }

  if (element instanceof HTMLVideoElement || element instanceof HTMLAudioElement) {
    return element.currentSrc.startsWith('blob:') || element.src.startsWith('blob:');
  }

  if (element instanceof HTMLAnchorElement) {
    return element.href.startsWith('blob:');
  }

  return Boolean(
    element.querySelector(
      'img[src^="blob:"],img[src^="data:image"],video[src^="blob:"],audio[src^="blob:"],a[href^="blob:"]',
    ),
  );
}

function getAttachmentTextBlob(element: HTMLElement): string {
  const attributes = [
    'aria-label',
    'title',
    'alt',
    'data-testid',
    'data-file-name',
    'data-filename',
    'data-file-id',
  ];
  const attrText = attributes
    .map(attribute => element.getAttribute(attribute))
    .filter(Boolean)
    .join(' ');
  const visibleText = (element.textContent || '').trim();

  return `${attrText} ${visibleText.length <= 140 ? visibleText : ''}`;
}

function inferAttachmentKind(element: HTMLElement): AttachmentKind {
  if (element instanceof HTMLInputElement && element.type === 'file') {
    const file = element.files?.[0];
    if (file?.type.startsWith('image/')) return 'image';
    if (file?.type.startsWith('video/') || file?.type.startsWith('audio/')) return 'media';
    return file ? 'file' : 'unknown';
  }

  if (
    element instanceof HTMLImageElement ||
    element.querySelector('img[src^="blob:"],img[src^="data:image"]')
  ) {
    return 'image';
  }

  if (
    element instanceof HTMLVideoElement ||
    element instanceof HTMLAudioElement ||
    element.querySelector('video[src^="blob:"],audio[src^="blob:"]')
  ) {
    return 'media';
  }

  const blob = getAttachmentTextBlob(element).toLowerCase();

  if (/\b(image|photo|picture|screenshot)\b|\.(png|jpe?g|webp|gif|svg|heic)\b/.test(blob)) {
    return 'image';
  }

  if (/\b(video|audio)\b|\.(mp4|mov|webm|mp3|wav)\b/.test(blob)) {
    return 'media';
  }

  if (/\b(file|document|pdf)\b|\.(pdf|docx?|xlsx?|pptx?|csv|txt|zip|json)\b/.test(blob)) {
    return 'file';
  }

  return 'unknown';
}

function uniqueAttachmentKinds(kinds: AttachmentKind[]): AttachmentKind[] {
  return Array.from(new Set(kinds));
}

function formatAttachmentSummary(kinds: AttachmentKind[]): string {
  const counts = kinds.reduce<Record<AttachmentKind, number>>(
    (acc, kind) => {
      acc[kind] += 1;
      return acc;
    },
    { image: 0, file: 0, media: 0, unknown: 0 },
  );
  const parts = (Object.keys(counts) as AttachmentKind[])
    .filter(kind => counts[kind] > 0)
    .map(kind => formatAttachmentPart(kind, counts[kind]));

  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;

  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

function formatAttachmentPart(kind: AttachmentKind, count: number): string {
  const label =
    kind === 'image'
      ? 'attached image'
      : kind === 'file'
        ? 'attached file'
        : kind === 'media'
          ? 'attached media item'
          : 'attached item';

  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function dispatchTextEvents(el: HTMLElement) {
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(el);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor?.set) {
    descriptor.set.call(el, value);
  } else {
    el.value = value;
  }
}

function getMutationTarget(): HTMLElement | null {
  const active = getActiveEditable();
  if (active) return active;
  if (lastCaptureTarget && document.contains(lastCaptureTarget)) return lastCaptureTarget;
  if (lastActiveEditable && document.contains(lastActiveEditable)) return lastActiveEditable;
  return null;
}

function replaceInputValue(el: HTMLInputElement | HTMLTextAreaElement, newText: string) {
  let start = el.selectionStart ?? 0;
  let end = el.selectionEnd ?? 0;

  if (start === end && lastInputSelection?.target === el) {
    start = lastInputSelection.start;
    end = lastInputSelection.end;
  }

  const hasSelection = start !== end;
  const value = hasSelection ? el.value.slice(0, start) + newText + el.value.slice(end) : newText;
  const caret = hasSelection ? start + newText.length : newText.length;

  setNativeValue(el, value);
  el.setSelectionRange(caret, caret);
  dispatchTextEvents(el);
  lastInputSelection = null;
}

function replaceContentEditable(el: HTMLElement, newText: string): boolean {
  el.focus();
  const selection = window.getSelection();
  let range = lastSelectionRange;

  if (!range || !document.contains(range.commonAncestorContainer) || !el.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(el);
  }

  try {
    selection?.removeAllRanges();
    selection?.addRange(range);

    if (document.queryCommandSupported?.('insertText')) {
      const inserted = document.execCommand('insertText', false, newText);
      if (inserted) {
        dispatchTextEvents(el);
        lastSelectionRange = null;
        return true;
      }
    }

    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    selection?.collapseToEnd();
  } catch {
    el.innerText = newText;
  }

  dispatchTextEvents(el);
  lastSelectionRange = null;
  return true;
}

function replaceText(newText: string): boolean {
  const target = getMutationTarget();
  if (!target || isFieldBlocked(target)) return false;

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    replaceInputValue(target, newText);
    return true;
  }

  if (target.isContentEditable) {
    return replaceContentEditable(target, newText);
  }

  return false;
}

// ─── Busy State ─────────────────────────────────────────────────────────────────

function getVisualContainer(target: HTMLElement): HTMLElement {
  const form = target.closest('form');
  if (form instanceof HTMLElement && isUsableVisualContainer(form, target)) {
    return form;
  }

  let current: HTMLElement | null = target.parentElement;
  while (current && current !== document.documentElement) {
    if (isUsableVisualContainer(current, target)) {
      return current;
    }
    current = current.parentElement;
  }

  return target;
}

function isUsableVisualContainer(candidate: HTMLElement, target: HTMLElement): boolean {
  if (!candidate.contains(target)) return false;

  const rect = candidate.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const visible =
    rect.width > 120 &&
    rect.height > 36 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth;

  if (!visible) return false;
  if (rect.height > Math.max(620, targetRect.height * 4)) return false;

  return rect.width >= Math.min(targetRect.width, 180);
}

function startBusyState(requestId = createRequestId()) {
  const target = getMutationTarget();
  if (!target || busyState?.target === target) return;

  stopBusyState();
  ensureBusyStyle();
  activeImproveRequestId = requestId;

  const visualTarget = getVisualContainer(target);
  busyState = {
    target,
    visualTarget,
    previousReadOnly:
      target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        ? target.readOnly
        : undefined,
    previousContentEditable: target.isContentEditable
      ? target.getAttribute('contenteditable')
      : undefined,
    previousAriaBusy: target.getAttribute('aria-busy'),
    previousStyle: {
      opacity: visualTarget.style.opacity,
      filter: visualTarget.style.filter,
      cursor: visualTarget.style.cursor,
      pointerEvents: target.style.pointerEvents,
      outline: visualTarget.style.outline,
      boxShadow: visualTarget.style.boxShadow,
    },
  };

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.readOnly = true;
  } else if (target.isContentEditable) {
    target.setAttribute('contenteditable', 'false');
  }

  target.setAttribute('aria-busy', 'true');
  target.style.pointerEvents = 'none';
  visualTarget.classList.add('btk-improving');

  window.getSelection()?.removeAllRanges();
  hideFloatingButton();

  window.clearTimeout(busyRecoveryTimer);
  busyRecoveryTimer = window.setTimeout(() => {
    if (activeImproveRequestId !== requestId) return;

    ignoredImproveRequestIds.add(requestId);
    window.setTimeout(() => ignoredImproveRequestIds.delete(requestId), 120000);
    stopBusyState(requestId);
    showToast('Bhai Thik Kor is taking too long. Your text box is unlocked.', 'error');
  }, IMPROVE_TIMEOUT_MS);
}

function stopBusyState(requestId?: string): boolean {
  if (requestId && activeImproveRequestId && activeImproveRequestId !== requestId) {
    return false;
  }

  window.clearTimeout(busyRecoveryTimer);
  activeImproveRequestId = null;

  if (!busyState) return true;

  const { target, visualTarget, previousStyle } = busyState;

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.readOnly = Boolean(busyState.previousReadOnly);
  } else if (busyState.previousContentEditable !== undefined) {
    if (busyState.previousContentEditable === null) {
      target.removeAttribute('contenteditable');
    } else {
      target.setAttribute('contenteditable', busyState.previousContentEditable);
    }
  }

  if (busyState.previousAriaBusy === null) {
    target.removeAttribute('aria-busy');
  } else if (busyState.previousAriaBusy !== undefined) {
    target.setAttribute('aria-busy', busyState.previousAriaBusy);
  }

  target.style.pointerEvents = previousStyle.pointerEvents;
  visualTarget.classList.remove('btk-improving');
  visualTarget.style.opacity = previousStyle.opacity;
  visualTarget.style.filter = previousStyle.filter;
  visualTarget.style.cursor = previousStyle.cursor;
  visualTarget.style.outline = previousStyle.outline;
  visualTarget.style.boxShadow = previousStyle.boxShadow;

  busyState = null;
  return true;
}

function insertBelow(newText: string): boolean {
  const target = getMutationTarget();
  if (!target || isFieldBlocked(target)) return false;

  if (target instanceof HTMLTextAreaElement) {
    const current = target.value;
    const separator = current.endsWith('\n') || !current ? '' : '\n\n';
    setNativeValue(target, current + separator + newText);
    dispatchTextEvents(target);
    return true;
  }

  if (target instanceof HTMLInputElement) {
    const separator = target.value.trim() ? ' | ' : '';
    setNativeValue(target, target.value + separator + newText);
    dispatchTextEvents(target);
    return true;
  }

  if (target.isContentEditable) {
    const separator = target.innerText.trim() ? '<br><br>' : '';
    target.insertAdjacentHTML('beforeend', `${separator}${escapeHtml(newText)}`);
    dispatchTextEvents(target);
    return true;
  }

  return false;
}

// ─── Overlay UI ─────────────────────────────────────────────────────────────────

function getOverlayRoot(): ShadowRoot {
  if (!overlayHost) {
    overlayHost = document.createElement('div');
    overlayHost.id = 'btk-overlay-root';
    overlayHost.style.position = 'fixed';
    overlayHost.style.zIndex = '2147483647';
    overlayHost.style.right = '16px';
    overlayHost.style.bottom = '16px';
    document.documentElement.appendChild(overlayHost);
    overlayHost.attachShadow({ mode: 'open' });
  }

  return overlayHost.shadowRoot as ShadowRoot;
}

function closeOverlay() {
  overlayHost?.remove();
  overlayHost = null;
}

function renderOverlayShell(kind: 'loading' | 'result' | 'error' | 'guided') {
  const root = getOverlayRoot();
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .card {
        width: min(390px, calc(100vw - 32px));
        max-height: min(680px, calc(100vh - 32px));
        overflow: auto;
        border: 1px solid #d6e8dd;
        border-radius: 12px;
        background: #fffdf8;
        color: #17211c;
        box-shadow: 0 18px 50px rgba(18, 31, 24, 0.24);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.5;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-bottom: 1px solid #e2efe7;
        background: linear-gradient(135deg, #fff8f2, #edf9f1);
      }
      .brand { display: flex; align-items: center; gap: 8px; font-weight: 750; }
      .mark { font-size: 18px; line-height: 1; }
      .close {
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #52625a;
        cursor: pointer;
        font-size: 20px;
        line-height: 1;
      }
      .close:hover { background: #eaf5ee; color: #17211c; }
      .body { padding: 14px; }
      .label {
        margin-bottom: 6px;
        color: #4f6f5d;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .prompt {
        max-height: 230px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        padding: 10px 11px;
        border: 1px solid #d9eadf;
        border-radius: 8px;
        background: #f7fbf5;
      }
      .original {
        max-height: 86px;
        margin-bottom: 10px;
        color: #56665e;
        background: #fff8f2;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 12px;
      }
      button.action {
        border: 1px solid #cfe3d7;
        border-radius: 7px;
        background: white;
        color: #26342d;
        cursor: pointer;
        font: inherit;
        font-weight: 650;
        padding: 7px 10px;
      }
      button.primary {
        border-color: #2f8f5b;
        background: #2f8f5b;
        color: white;
      }
      button.danger {
        border-color: #f4cbc6;
        background: #fff5f3;
        color: #a33b31;
      }
      button.action:hover { filter: brightness(0.97); }
      .routing { display: grid; gap: 6px; margin-top: 12px; }
      .route {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 9px;
        border: 1px solid #d9eadf;
        border-radius: 8px;
        background: white;
      }
      .tier { color: #607167; font-size: 10px; font-weight: 800; text-transform: uppercase; }
      .model { margin-top: 1px; font-weight: 700; }
      .spinner {
        width: 28px;
        height: 28px;
        border: 3px solid #d9eadf;
        border-top-color: #e94f57;
        border-radius: 999px;
        animation: spin 0.8s linear infinite;
      }
      .loading { display: flex; align-items: center; gap: 12px; color: #4f6f5d; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .error { color: #a33b31; }
      .question { display: grid; gap: 7px; padding: 10px 0; border-bottom: 1px solid #edf4ee; }
      .question:last-child { border-bottom: 0; }
      .question-title { font-weight: 700; }
      .options { display: flex; flex-wrap: wrap; gap: 6px; }
      .option {
        border: 1px solid #cfe3d7;
        border-radius: 999px;
        background: white;
        color: #26342d;
        cursor: pointer;
        font: inherit;
        padding: 5px 9px;
      }
      .option.selected { border-color: #e94f57; background: #fff1f1; color: #ad3139; }
      .custom {
        width: 100%;
        border: 1px solid #cfe3d7;
        border-radius: 7px;
        color: #17211c;
        font: inherit;
        padding: 7px 9px;
      }
      .custom:focus { outline: 2px solid rgba(47, 143, 91, 0.22); border-color: #2f8f5b; }
      .status { min-height: 18px; margin-top: 8px; color: #4f6f5d; font-size: 12px; }
      .hidden { display: none; }
    </style>
    <section class="card ${kind}">
      <header class="header">
        <div class="brand"><span class="mark">🍉</span><span>Bhai Thik Kor</span></div>
        <button class="close" title="Dismiss" aria-label="Dismiss">×</button>
      </header>
      <div class="body"></div>
    </section>
  `;
  root.querySelector('.close')?.addEventListener('click', closeOverlay);
  return root;
}

function showLoadingOverlay(text: string, source: ImproveSource) {
  const root = renderOverlayShell('loading');
  const body = root.querySelector('.body') as HTMLElement;
  body.innerHTML = `
    <div class="loading">
      <div class="spinner" aria-hidden="true"></div>
      <div>
        <div class="label">Improving</div>
        <div class="loading-copy"></div>
      </div>
    </div>
  `;
  setText(root, '.loading-copy', source === 'floating' ? 'Working on this field...' : 'Working on your selected text...');
  if (text) {
    body.appendChild(createPromptBlock('Original', text, true));
  }
}

function showResultOverlay(result: GenerateResult, originalText = '') {
  const root = renderOverlayShell('result');
  const body = root.querySelector('.body') as HTMLElement;

  if (originalText) {
    body.appendChild(createPromptBlock('Original', originalText, true));
  }

  body.appendChild(createPromptBlock('Optimized Prompt', result.optimized_prompt));

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    createActionButton('Copy', 'primary', () => copyText(result.optimized_prompt, root)),
    createActionButton('Replace', '', () => {
      const success = replaceText(result.optimized_prompt);
      setOverlayStatus(root, success ? 'Replaced.' : 'Replacement is unavailable for this field.');
    }),
    createActionButton('Insert', '', () => {
      const success = insertBelow(result.optimized_prompt);
      setOverlayStatus(root, success ? 'Inserted.' : 'Insert is unavailable for this field.');
    }),
    createActionButton('Guide', '', () => startGuidedFromOverlay(originalText || result.optimized_prompt)),
    createActionButton('Website', '', () => {
      void openWebsiteFromPage(result.optimized_prompt, undefined, root);
    }),
  );
  body.appendChild(actions);

  const routing = document.createElement('div');
  routing.className = 'routing';
  for (const [key, label] of [
    ['open_source', 'Open Source'],
    ['freemium', 'Freemium'],
    ['premium', 'Premium'],
  ] as const) {
    const rec = result.routing[key];
    if (!rec) continue;

    const route = document.createElement('div');
    route.className = 'route';

    const left = document.createElement('div');
    const tier = document.createElement('div');
    tier.className = 'tier';
    tier.textContent = label;
    const model = document.createElement('div');
    model.className = 'model';
    model.textContent = rec.model_name;
    left.append(tier, model);

    const tryButton = createActionButton('Try', '', () => {
      void openWebsiteFromPage(result.optimized_prompt, rec.platform_id, root);
    });
    tryButton.title = rec.reasoning;
    route.append(left, tryButton);
    routing.appendChild(route);
  }
  body.appendChild(routing);

  const status = document.createElement('div');
  status.className = 'status';
  body.appendChild(status);
}

function showErrorOverlay(error: string, originalText = '') {
  const root = renderOverlayShell('error');
  const body = root.querySelector('.body') as HTMLElement;
  const message = document.createElement('div');
  message.className = 'error';
  message.textContent = error;
  body.appendChild(message);

  if (originalText) {
    body.appendChild(createPromptBlock('Original', originalText, true));
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(
    createActionButton('Copy Original', '', () => copyText(originalText, root)),
    createActionButton('Dismiss', 'danger', closeOverlay),
  );
  body.appendChild(actions);

  const status = document.createElement('div');
  status.className = 'status';
  body.appendChild(status);
}

function createPromptBlock(labelText: string, text: string, original = false): HTMLElement {
  const wrapper = document.createElement('div');
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = labelText;
  const prompt = document.createElement('div');
  prompt.className = original ? 'prompt original' : 'prompt';
  prompt.textContent = text;
  wrapper.append(label, prompt);
  return wrapper;
}

function createActionButton(
  label: string,
  variant: 'primary' | 'danger' | '' = '',
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `action ${variant}`.trim();
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function copyText(text: string, root: ShadowRoot) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  setOverlayStatus(root, 'Copied.');
}

async function openWebsiteFromPage(prompt?: string, platformId?: string, root?: ShadowRoot) {
  const text = prompt?.trim();
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      if (root) {
        setOverlayStatus(root, 'Prompt copied. Website opened without adding it to the URL.');
      }
    } catch {
      if (root) {
        setOverlayStatus(root, 'Website opened. Copy manually if you need the prompt there.');
      }
    }
  }

  window.open(buildWebsiteUrl(undefined, platformId), '_blank', 'noopener,noreferrer');
}

function setOverlayStatus(root: ShadowRoot, message: string) {
  setText(root, '.status', message);
}

function setText(root: ShadowRoot, selector: string, text: string) {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

// ─── Guided Mode Overlay ────────────────────────────────────────────────────────

async function startGuidedFromOverlay(text: string) {
  if (!text.trim()) return;

  showLoadingOverlay(text, 'floating');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'CLARIFY_REQUEST',
      payload: { text },
    } satisfies Message);

    if (response?.type === 'CLARIFY_RESPONSE') {
      showGuidedQuestions(text, response.payload.questions);
    } else {
      showErrorOverlay(response?.payload?.error || 'Guided Mode is unavailable.', text);
    }
  } catch {
    showErrorOverlay('Guided Mode is unavailable.', text);
  }
}

function showGuidedQuestions(text: string, questions: ClarifyingQuestion[]) {
  if (!questions.length) {
    void generateWithClarifications(text, []);
    return;
  }

  const root = renderOverlayShell('guided');
  const body = root.querySelector('.body') as HTMLElement;
  const answers = new Map<string, string>();

  const intro = document.createElement('div');
  intro.className = 'label';
  intro.textContent = 'Guide Me';
  body.appendChild(intro);

  questions.forEach((question) => {
    const questionEl = document.createElement('div');
    questionEl.className = 'question';

    const title = document.createElement('div');
    title.className = 'question-title';
    title.textContent = question.question;
    questionEl.appendChild(title);

    const options = document.createElement('div');
    options.className = 'options';

    question.options.forEach((option) => {
      const button = document.createElement('button');
      button.className = 'option';
      button.type = 'button';
      button.textContent = option;
      button.addEventListener('click', () => {
        options.querySelectorAll('.option').forEach(el => el.classList.remove('selected'));
        button.classList.add('selected');
        custom.value = '';
        answers.set(question.question, option);
        updateSubmit();
      });
      options.appendChild(button);
    });

    const custom = document.createElement('input');
    custom.className = 'custom';
    custom.type = 'text';
    custom.placeholder = 'Custom answer';
    custom.addEventListener('input', () => {
      options.querySelectorAll('.option').forEach(el => el.classList.remove('selected'));
      if (custom.value.trim()) {
        answers.set(question.question, custom.value.trim());
      } else {
        answers.delete(question.question);
      }
      updateSubmit();
    });

    questionEl.append(options, custom);
    body.appendChild(questionEl);
  });

  const actions = document.createElement('div');
  actions.className = 'actions';
  const submit = createActionButton('Generate Prompt', 'primary', () => {
    const clarifications: Clarification[] = Array.from(answers.entries()).map(
      ([question, answer]) => ({ question, answer }),
    );
    void generateWithClarifications(text, clarifications);
  });
  submit.disabled = true;
  actions.append(submit);
  body.appendChild(actions);

  function updateSubmit() {
    submit.disabled = answers.size < questions.length;
  }
}

async function generateWithClarifications(text: string, clarifications: Clarification[]) {
  showLoadingOverlay(text, 'floating');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_WITH_CLARIFICATIONS',
      payload: { text, clarifications },
    } satisfies Message);

    if (response?.type === 'IMPROVE_RESPONSE') {
      showResultOverlay(response.payload.result, text);
    } else {
      showErrorOverlay(response?.payload?.error || 'Failed to generate prompt.', text);
    }
  } catch {
    showErrorOverlay('Failed to generate prompt.', text);
  }
}

// ─── Floating Field Button ──────────────────────────────────────────────────────

function scheduleFloatingUpdate() {
  window.clearTimeout(floatingTimer);
  floatingTimer = window.setTimeout(updateFloatingButton, 120);
}

function updateFloatingButton() {
  if (busyState) {
    hideFloatingButton();
    return;
  }

  const target = getActiveEditable();
  if (!target || isFieldBlocked(target)) {
    hideFloatingButton();
    return;
  }

  lastActiveEditable = target;
  const text = getEditableText(target).trim();
  if (!looksPromptLike(text)) {
    hideFloatingButton();
    return;
  }

  showFloatingButton(target);
}

function showFloatingButton(target: HTMLElement) {
  cleanupFloatingHosts(floatingHost);

  if (!floatingHost) {
    floatingHost = document.createElement('div');
    floatingHost.id = 'btk-floating-root';
    floatingHost.style.position = 'fixed';
    floatingHost.style.zIndex = '2147483646';
    document.documentElement.appendChild(floatingHost);
    floatingHost.attachShadow({ mode: 'open' });

    const root = floatingHost.shadowRoot as ShadowRoot;
    root.innerHTML = `
      <style>
        :host { all: initial; }
        button {
          width: 34px;
          height: 34px;
          border: 1px solid #cfe3d7;
          border-radius: 999px;
          background: #fffdf8;
          box-shadow: 0 8px 24px rgba(18, 31, 24, 0.2);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        button:hover { transform: translateY(-1px); }
      </style>
      <button type="button" title="Improve with Bhai Thik Kor" aria-label="Improve with Bhai Thik Kor">🍉</button>
    `;
    root.querySelector('button')?.addEventListener('mousedown', event => event.preventDefault());
    root.querySelector('button')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void improveActiveField();
    });
  }

  const rect = getVisibleAnchorRect(target);
  if (!rect) {
    hideFloatingButton();
    return;
  }

  floatingHost.style.left = `${Math.max(8, Math.min(window.innerWidth - 42, rect.right - 44))}px`;
  floatingHost.style.top = `${Math.max(8, Math.min(window.innerHeight - 42, rect.top + 10))}px`;
}

function hideFloatingButton() {
  floatingHost?.remove();
  floatingHost = null;
}

function looksPromptLike(text: string): boolean {
  if (text.length < 24) return false;
  if (AI_WORKFLOW_DOMAINS.some(pattern => pattern.test(window.location.hostname))) return true;

  const lower = text.toLowerCase();
  return PROMPT_WORDS.some(word => lower.includes(word));
}

function getVisibleAnchorRect(target: HTMLElement): DOMRect | null {
  const anchor = getVisualContainer(target);
  const rect = anchor.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const right = Math.min(window.innerWidth, rect.right);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  const left = Math.max(0, rect.left);

  if (right <= left || bottom <= top) return null;

  return {
    ...rect,
    top,
    right,
    bottom,
    left,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

async function improveActiveField() {
  const snapshot = getSelectedText();
  const text = snapshot.text.trim();

  if (snapshot.isBlocked) {
    showToast('Protected field skipped. Nothing was sent.', 'error');
    return;
  }

  if (text.length < PROMPT_MIN_CHARS) {
    showToast('Write a little more first.', 'info');
    return;
  }

  const requestId = createRequestId();
  hideFloatingButton();
  closeOverlay();
  startBusyState(requestId);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'IMPROVE_REQUEST',
      payload: {
        text,
        source: 'floating',
        requestId,
        attachmentContext: snapshot.attachmentContext,
      },
    } satisfies Message);

    if (
      ignoredImproveRequestIds.has(requestId) ||
      (response?.payload?.requestId && response.payload.requestId !== requestId)
    ) {
      return;
    }

    if (response?.type === 'IMPROVE_RESPONSE') {
      if (!stopBusyState(requestId)) return;
      replaceText(response.payload.result.optimized_prompt);
      showToast('Prompt improved in place.', 'success');
    } else {
      if (!stopBusyState(requestId)) return;
      showToast(response?.payload?.error || 'Failed to improve prompt.', 'error');
    }
  } catch {
    if (!stopBusyState(requestId)) return;
    showToast('Could not reach Bhai Thik Kor. Check your connection.', 'error');
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

function cleanupTransientUi() {
  document.querySelectorAll('#btk-floating-root, #btk-overlay-root, #btk-toast-root').forEach(node => {
    node.remove();
  });
}

function cleanupFloatingHosts(current?: HTMLDivElement | null) {
  document.querySelectorAll('#btk-floating-root').forEach(node => {
    if (node !== current) node.remove();
  });
}

function ensureBusyStyle() {
  if (document.getElementById('btk-busy-style')) return;

  const style = document.createElement('style');
  style.id = 'btk-busy-style';
  style.textContent = `
    @keyframes btkGradientGlow {
      0% {
        background-position: 0% 50%;
        box-shadow: 0 0 14px rgba(52, 211, 153, 0.62), 0 0 26px rgba(244, 63, 94, 0.22);
      }
      50% {
        background-position: 100% 50%;
        box-shadow: 0 0 16px rgba(244, 63, 94, 0.55), 0 0 30px rgba(52, 211, 153, 0.28);
      }
      100% {
        background-position: 0% 50%;
        box-shadow: 0 0 14px rgba(52, 211, 153, 0.62), 0 0 26px rgba(244, 63, 94, 0.22);
      }
    }

    .btk-improving {
      position: relative !important;
      opacity: 0.58 !important;
      filter: saturate(0.9) brightness(0.94) !important;
      cursor: progress !important;
    }

    .btk-improving::after {
      content: "";
      position: absolute;
      inset: -4px;
      z-index: 2147483000;
      pointer-events: none;
      border-radius: inherit;
      padding: 2px;
      background: linear-gradient(115deg, #34d399, #10b981, #f43f5e, #ef4444, #34d399);
      background-size: 240% 240%;
      animation: btkGradientGlow 1.05s ease-in-out infinite;
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
    }
  `;
  document.documentElement.appendChild(style);
}

function showToast(message: string, tone: 'success' | 'error' | 'info' = 'info') {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'btk-toast-root';
    toastHost.style.position = 'fixed';
    toastHost.style.zIndex = '2147483647';
    toastHost.style.left = '50%';
    toastHost.style.bottom = '24px';
    toastHost.style.transform = 'translateX(-50%)';
    document.documentElement.appendChild(toastHost);
    toastHost.attachShadow({ mode: 'open' });
  }

  const root = toastHost.shadowRoot as ShadowRoot;
  const accent =
    tone === 'success'
      ? '#34d399'
      : tone === 'error'
        ? '#f43f5e'
        : '#f8b4c4';

  root.innerHTML = `
    <style>
      :host { all: initial; }
      .toast {
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: min(520px, calc(100vw - 32px));
        padding: 10px 13px;
        border: 1px solid ${accent};
        border-radius: 999px;
        background: rgba(18, 24, 22, 0.94);
        color: #fffdf8;
        box-shadow: 0 14px 40px rgba(0, 0, 0, 0.28);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        line-height: 1.35;
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 999px;
        background: ${accent};
        box-shadow: 0 0 14px ${accent};
        flex: 0 0 auto;
      }
    </style>
    <div class="toast" role="status" aria-live="polite">
      <span class="dot" aria-hidden="true"></span>
      <span class="message"></span>
    </div>
  `;
  const messageEl = root.querySelector('.message');
  if (messageEl) messageEl.textContent = message;

  window.setTimeout(() => {
    if (toastHost?.shadowRoot === root) {
      toastHost.remove();
      toastHost = null;
    }
  }, 3200);
}

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function cacheSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

  const editable = getSelectionEditable();
  if (editable && !isFieldBlocked(editable)) {
    lastActiveEditable = editable;
    lastCaptureTarget = editable;
    lastSelectionRange = selection.getRangeAt(0).cloneRange();
  }
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

      case 'IMPROVE_STARTED': {
        closeOverlay();
        startBusyState(message.payload.requestId);
        return false;
      }

      case 'IMPROVE_RESPONSE': {
        if (
          message.payload.requestId &&
          ignoredImproveRequestIds.has(message.payload.requestId)
        ) {
          return false;
        }

        if (
          message.payload.requestId &&
          activeImproveRequestId &&
          message.payload.requestId !== activeImproveRequestId
        ) {
          return false;
        }

        closeOverlay();
        hideFloatingButton();
        if (!stopBusyState(message.payload.requestId)) return false;
        const success = replaceText(message.payload.result.optimized_prompt);
        if (!success) {
          showToast('Could not replace text in this field.', 'error');
        } else {
          showToast('Prompt improved in place.', 'success');
        }
        return false;
      }

      case 'IMPROVE_ERROR': {
        if (
          message.payload.requestId &&
          ignoredImproveRequestIds.has(message.payload.requestId)
        ) {
          return false;
        }

        closeOverlay();
        if (!stopBusyState(message.payload.requestId)) return false;
        showToast(message.payload.error, 'error');
        return false;
      }
    }
  },
);

document.addEventListener('focusin', scheduleFloatingUpdate, {
  capture: true,
  signal: contentController.signal,
});
document.addEventListener('input', scheduleFloatingUpdate, {
  capture: true,
  signal: contentController.signal,
});
document.addEventListener('keyup', scheduleFloatingUpdate, {
  capture: true,
  signal: contentController.signal,
});
document.addEventListener('mouseup', () => {
  cacheSelection();
  scheduleFloatingUpdate();
}, {
  capture: true,
  signal: contentController.signal,
});
document.addEventListener('selectionchange', cacheSelection, {
  signal: contentController.signal,
});
window.addEventListener('scroll', scheduleFloatingUpdate, {
  capture: true,
  signal: contentController.signal,
});
window.addEventListener('resize', scheduleFloatingUpdate, {
  signal: contentController.signal,
});
