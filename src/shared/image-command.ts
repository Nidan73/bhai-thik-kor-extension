/**
 * Heuristic for "improve it"-style commands that refer to an attached image
 * rather than to text. Pure so it can be tested without the Chrome runtime.
 */
export function looksLikeShortImageEditCommand(prompt: string): boolean {
  const normalized = prompt.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;

  const words = normalized.split(' ');
  if (words.length > 8) return false;
  if (/\b(text|copy|caption|headline|section|paragraph|report|analyze|analysis|describe|summarize|extract|ocr|read|write|rewrite|grammar)\b/.test(normalized)) {
    return false;
  }

  return /\b(improve|enhance|fix|edit|polish|retouch|restore|sharpen|upscale|clean|beautify)\b/.test(normalized) ||
    /\bmake (it|this|image|photo|picture) (better|nicer|cleaner|sharper|professional)\b/.test(normalized);
}
