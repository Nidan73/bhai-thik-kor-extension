/**
 * Attachment detection.
 *
 * Pure DOM analysis: given an already-resolved search root, report what looks
 * like user-attached files near the composer. The root is resolved by the
 * caller because that needs content-script module state.
 */

import type { AttachmentContext, AttachmentKind } from '@/shared/types';

export function detectAttachmentContext(root: HTMLElement | null): AttachmentContext | undefined {
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
