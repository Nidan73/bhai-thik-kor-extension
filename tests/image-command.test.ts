import { describe, expect, it } from 'vitest';
import { looksLikeShortImageEditCommand } from '../src/shared/image-command';

describe('looksLikeShortImageEditCommand', () => {
  it('accepts a short edit command', () => {
    expect(looksLikeShortImageEditCommand('improve it')).toBe(true);
    expect(looksLikeShortImageEditCommand('make this better')).toBe(true);
    expect(looksLikeShortImageEditCommand('sharpen this photo')).toBe(true);
  });

  it('rejects commands about text inside the image', () => {
    expect(looksLikeShortImageEditCommand('improve the caption')).toBe(false);
    expect(looksLikeShortImageEditCommand('fix the grammar')).toBe(false);
    expect(looksLikeShortImageEditCommand('summarize this')).toBe(false);
  });

  it('rejects anything longer than eight words', () => {
    expect(
      looksLikeShortImageEditCommand('improve this one a lot more than you normally would'),
    ).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(looksLikeShortImageEditCommand('')).toBe(false);
  });
});
