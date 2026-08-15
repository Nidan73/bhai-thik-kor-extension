import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_DISABLED_HOSTS,
  isHostDisabled,
  mergeSettings,
} from '../src/shared/settings';

describe('mergeSettings', () => {
  it('returns defaults for undefined storage', () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('returns defaults for a non-object value', () => {
    expect(mergeSettings('corrupt')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps stored values that are valid', () => {
    const merged = mergeSettings({
      floatingButton: false,
      improveBehavior: 'preview',
      adaptiveStyleEnabled: false,
      customPersona: 'Senior Go Dev',
    });
    expect(merged.floatingButton).toBe(false);
    expect(merged.improveBehavior).toBe('preview');
    expect(merged.adaptiveStyleEnabled).toBe(false);
    expect(merged.customPersona).toBe('Senior Go Dev');
  });

  it('falls back to defaults for individually invalid fields', () => {
    const merged = mergeSettings({
      floatingButton: 'yes',
      improveBehavior: 'wat',
      adaptiveStyleEnabled: 123,
      customPersona: 999,
    });
    expect(merged.floatingButton).toBe(DEFAULT_SETTINGS.floatingButton);
    expect(merged.improveBehavior).toBe(DEFAULT_SETTINGS.improveBehavior);
    expect(merged.adaptiveStyleEnabled).toBe(DEFAULT_SETTINGS.adaptiveStyleEnabled);
    expect(merged.customPersona).toBe(DEFAULT_SETTINGS.customPersona);
  });

  it('drops non-string entries from disabledHosts', () => {
    const merged = mergeSettings({ disabledHosts: ['a.com', 42, '', 'b.com'] });
    expect(merged.disabledHosts).toEqual(['a.com', 'b.com']);
  });

  it('caps disabledHosts at the maximum', () => {
    const hosts = Array.from({ length: MAX_DISABLED_HOSTS + 20 }, (_, i) => `h${i}.com`);
    expect(mergeSettings({ disabledHosts: hosts }).disabledHosts).toHaveLength(MAX_DISABLED_HOSTS);
  });

  it('does not share the default array between calls', () => {
    const first = mergeSettings(undefined);
    first.disabledHosts.push('leak.com');
    expect(mergeSettings(undefined).disabledHosts).toEqual([]);
  });
});

describe('isHostDisabled', () => {
  const settings = { ...DEFAULT_SETTINGS, disabledHosts: ['mail.google.com'] };

  it('matches an exact hostname', () => {
    expect(isHostDisabled(settings, 'mail.google.com')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isHostDisabled(settings, 'Mail.Google.com')).toBe(true);
  });

  it('does not match a different subdomain', () => {
    expect(isHostDisabled(settings, 'docs.google.com')).toBe(false);
  });
});
