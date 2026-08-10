# Chrome Web Store Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Bhai Thik Kor v1.0.0 to the Chrome Web Store by adding the user-facing controls, privacy material, and test scaffolding a submission requires.

**Architecture:** A new `src/shared/settings.ts` (synced prefs) and `src/shared/history.ts` (local, opt-in) become the single source of truth for user preferences; the popup, options page, content script, and background worker all read them. Reaching that requires splitting the Vite build into two passes so the content script can import shared modules while still emitting one flat, import-free `dist/content.js`. Behavior changes are additive: a settings gate on the floating button, an undo action on the success toast, and an optional preview mode that routes results to the existing overlay instead of mutating text.

**Tech Stack:** Chrome Manifest V3, TypeScript (strict, ES2022), Vite 6, Tailwind CSS 3 (popup/options only), Vitest, vanilla DOM + Shadow DOM. No framework.

## Global Constraints

- `dist/content.js` must stay a classic, self-contained script — no static `import`/`export`, no shared-chunk import. `scripts/check-content-script.mjs` enforces this and must keep passing unmodified.
- All network calls go through the background service worker. The content script and popup never `fetch()` the API.
- Every runtime message must be a member of the `Message` union in `src/shared/types.ts`; senders use `satisfies Message`.
- Never send text without explicit user action. Never mutate user text except on an explicit improve/replace/insert action.
- Respect the existing field guards (`isFieldBlocked`, `SENSITIVE_*`, `BLOCKED_AUTOCOMPLETE`). Blocked field → copy works, replacement does not.
- Never put prompt text in a website URL. `buildWebsiteUrl()` ignores the prompt by design.
- Settings live in `chrome.storage.sync`; history lives in `chrome.storage.local` and never syncs.
- `disabledHosts` is capped at 100 hostnames.
- History is capped at 50 entries, newest first.
- Disabled hosts and `floatingButton: false` suppress **automatic** UI only. Context menu and `Alt+I` keep working.
- Undo is offered only for `input` and `textarea` targets, never `contenteditable`.
- No new permissions. `storage` is already declared.
- Section banner comments (`// ─── Name ───`) separate concerns inside a file. Match the existing style.
- Build DOM with `createElement` + `textContent` for anything derived from API or page text.

---

### Task 1: Split the Vite build into two passes

**Files:**
- Create: `vite.content.config.ts`
- Modify: `vite.config.ts:11-22` (remove the `content` entry, add `options`)
- Modify: `package.json:7-11` (scripts)
- Modify: `src/content/index.ts:19-50` (delete the duplicated constants, import from shared)

**Interfaces:**
- Consumes: nothing.
- Produces: a build in which `src/content/index.ts` may `import` from `src/shared/` while `dist/content.js` stays flat. Every later content-script task depends on this.

- [ ] **Step 1: Create the content-only build config**

Create `vite.content.config.ts`:

```ts
import { defineConfig } from 'vite';
import { resolve } from 'path';

// The content script is built alone so Rollup inlines every import into one
// flat file. dist/content.js must stay a classic script — see
// scripts/check-content-script.mjs.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: { content: resolve(__dirname, 'src/content/index.ts') },
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'content.js',
      },
    },
    target: 'es2022',
    minify: false,
    sourcemap: process.env.NODE_ENV !== 'production' ? 'inline' : false,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  publicDir: false,
});
```

- [ ] **Step 2: Remove the content entry from the main config**

In `vite.config.ts`, replace the `input` block. The content script is now built by pass 2; the `options` entry is added in Task 8, once that file exists.

```ts
      input: {
        popup: resolve(__dirname, 'src/popup/index.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
```

- [ ] **Step 3: Wire both passes into the scripts**

In `package.json`, replace the `scripts` block:

```json
  "scripts": {
    "dev": "vite build --watch",
    "dev:content": "vite build --config vite.content.config.ts --watch",
    "build": "tsc --noEmit && vite build && vite build --config vite.content.config.ts && node scripts/check-content-script.mjs",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
```

Note for the implementer: `npm run dev` now covers popup and background only. Run `npm run dev:content` in a second terminal when working on the content script.

- [ ] **Step 4: Run the build and confirm both passes emit**

Run: `npm run build`
Expected: two Vite build summaries, then `content script guard passed`. `dist/content.js` exists and `dist/background.js` exists.

- [ ] **Step 5: Delete the duplicated constants from the content script**

In `src/content/index.ts`, delete lines 20 and 37-50 (the `WEBSITE_URL` constant and the local `buildWebsiteUrl` function) and add the import to the existing import block at the top:

```ts
import { buildWebsiteUrl } from '@/shared/constants';
```

Leave `const PROMPT_MIN_CHARS = 3;` and `const CONTENT_STATE_KEY` alone — `PROMPT_MIN_CHARS` also exists in `src/shared/constants.ts`, but replacing it is not required by this task and every changed line should trace to the task.

- [ ] **Step 6: Verify the guard still passes with a real shared import**

Run: `npm run build`
Expected: `content script guard passed`. Then confirm the import was inlined rather than emitted:

Run: `grep -c "^import\|^export" dist/content.js`
Expected: `0`

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts vite.content.config.ts package.json src/content/index.ts
git commit -m "build: split content script into its own Vite pass

Lets the content script import from src/shared/ while dist/content.js stays a
flat, import-free classic script. Removes the duplicated buildWebsiteUrl."
```

---

### Task 2: Settings module with pure, tested merge logic

**Files:**
- Create: `src/shared/settings.ts`
- Create: `tests/settings.test.ts`
- Modify: `package.json` (add `vitest`, add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ImproveBehavior = 'replace' | 'preview'`
  - `type Settings = { floatingButton: boolean; disabledHosts: string[]; improveBehavior: ImproveBehavior; historyEnabled: boolean; seenWelcome: boolean }`
  - `DEFAULT_SETTINGS: Settings`, `MAX_DISABLED_HOSTS: number`
  - `mergeSettings(stored: unknown): Settings`
  - `isHostDisabled(settings: Settings, hostname: string): boolean`
  - `getSettings(): Promise<Settings>`
  - `setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean>`
  - `onSettingsChanged(callback: (settings: Settings) => void): void`

- [ ] **Step 1: Install Vitest and add the test script**

Run: `npm install --save-dev vitest`

Then add to `scripts` in `package.json`, after `"typecheck"`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 2: Write the failing tests**

Create `tests/settings.test.ts`:

```ts
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
    const merged = mergeSettings({ floatingButton: false, improveBehavior: 'preview' });
    expect(merged.floatingButton).toBe(false);
    expect(merged.improveBehavior).toBe('preview');
  });

  it('falls back to defaults for individually invalid fields', () => {
    const merged = mergeSettings({ floatingButton: 'yes', improveBehavior: 'wat' });
    expect(merged.floatingButton).toBe(DEFAULT_SETTINGS.floatingButton);
    expect(merged.improveBehavior).toBe(DEFAULT_SETTINGS.improveBehavior);
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `Failed to resolve import "../src/shared/settings"`.

- [ ] **Step 4: Write the settings module**

Create `src/shared/settings.ts`:

```ts
// ─── Types ──────────────────────────────────────────────────────────────────────

export type ImproveBehavior = 'replace' | 'preview';

export type Settings = {
  floatingButton: boolean;
  disabledHosts: string[];
  improveBehavior: ImproveBehavior;
  historyEnabled: boolean;
  seenWelcome: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  floatingButton: true,
  disabledHosts: [],
  improveBehavior: 'replace',
  historyEnabled: false,
  seenWelcome: false,
};

export const MAX_DISABLED_HOSTS = 100;

const SETTINGS_KEY = 'settings';

// ─── Pure Logic ─────────────────────────────────────────────────────────────────

/**
 * Merge stored values over the defaults. Never throws, never returns undefined:
 * a broken settings read must not be able to disable improving.
 */
export function mergeSettings(stored: unknown): Settings {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_SETTINGS, disabledHosts: [] };
  }

  const raw = stored as Record<string, unknown>;

  return {
    floatingButton:
      typeof raw.floatingButton === 'boolean' ? raw.floatingButton : DEFAULT_SETTINGS.floatingButton,
    disabledHosts: Array.isArray(raw.disabledHosts)
      ? raw.disabledHosts
          .filter((host): host is string => typeof host === 'string' && host.length > 0)
          .slice(0, MAX_DISABLED_HOSTS)
      : [],
    improveBehavior:
      raw.improveBehavior === 'preview' || raw.improveBehavior === 'replace'
        ? raw.improveBehavior
        : DEFAULT_SETTINGS.improveBehavior,
    historyEnabled:
      typeof raw.historyEnabled === 'boolean' ? raw.historyEnabled : DEFAULT_SETTINGS.historyEnabled,
    seenWelcome:
      typeof raw.seenWelcome === 'boolean' ? raw.seenWelcome : DEFAULT_SETTINGS.seenWelcome,
  };
}

export function isHostDisabled(settings: Settings, hostname: string): boolean {
  return settings.disabledHosts.includes(hostname.toLowerCase());
}

// ─── Storage ────────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<Settings> {
  try {
    const data = await chrome.storage.sync.get(SETTINGS_KEY);
    return mergeSettings(data?.[SETTINGS_KEY]);
  } catch {
    return mergeSettings(undefined);
  }
}

/** Returns false when the write failed (sync disabled, quota exceeded). */
export async function setSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
): Promise<boolean> {
  try {
    const current = await getSettings();
    await chrome.storage.sync.set({ [SETTINGS_KEY]: { ...current, [key]: value } });
    return true;
  } catch {
    return false;
  }
}

export function onSettingsChanged(callback: (settings: Settings) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes[SETTINGS_KEY]) return;
    callback(mergeSettings(changes[SETTINGS_KEY].newValue));
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Verify the build still typechecks**

Run: `npm run build`
Expected: passes, ending in `content script guard passed`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/shared/settings.ts tests/settings.test.ts
git commit -m "feat: add settings module with tested merge logic

Adds Vitest. mergeSettings and isHostDisabled are pure so they can be tested
without mocking chrome.storage."
```

---

### Task 3: History module

**Files:**
- Create: `src/shared/history.ts`
- Create: `tests/history.test.ts`

**Interfaces:**
- Consumes: `ImproveSource` from `src/shared/types.ts`.
- Produces:
  - `type HistoryEntry = { id: string; at: number; original: string; optimized: string; source: ImproveSource; host?: string }`
  - `HISTORY_LIMIT: number`
  - `pruneHistory(entries: HistoryEntry[]): HistoryEntry[]`
  - `getHistory(): Promise<HistoryEntry[]>`
  - `appendHistory(entry: HistoryEntry): Promise<void>`
  - `deleteHistoryEntry(id: string): Promise<void>`
  - `clearHistory(): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `tests/history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, pruneHistory, type HistoryEntry } from '../src/shared/history';

function entry(id: string): HistoryEntry {
  return { id, at: 0, original: 'a', optimized: 'b', source: 'popup' };
}

describe('pruneHistory', () => {
  it('leaves a short list untouched', () => {
    const entries = [entry('1'), entry('2')];
    expect(pruneHistory(entries)).toEqual(entries);
  });

  it('caps the list at the limit', () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => entry(String(i)));
    expect(pruneHistory(entries)).toHaveLength(HISTORY_LIMIT);
  });

  it('drops the oldest entries, keeping the newest first', () => {
    const entries = Array.from({ length: HISTORY_LIMIT + 1 }, (_, i) => entry(String(i)));
    const pruned = pruneHistory(entries);
    expect(pruned[0].id).toBe('0');
    expect(pruned.at(-1)?.id).toBe(String(HISTORY_LIMIT - 1));
  });

  it('keeps exactly the limit at the boundary', () => {
    const entries = Array.from({ length: HISTORY_LIMIT }, (_, i) => entry(String(i)));
    expect(pruneHistory(entries)).toHaveLength(HISTORY_LIMIT);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/history.test.ts`
Expected: FAIL — `Failed to resolve import "../src/shared/history"`.

- [ ] **Step 3: Write the history module**

Create `src/shared/history.ts`:

```ts
import type { ImproveSource } from './types';

// ─── Types ──────────────────────────────────────────────────────────────────────

export type HistoryEntry = {
  id: string;
  at: number;
  original: string;
  optimized: string;
  source: ImproveSource;
  /** Absent for popup-originated improves, which have no tab context. */
  host?: string;
};

export const HISTORY_LIMIT = 50;

const HISTORY_KEY = 'history';

// ─── Pure Logic ─────────────────────────────────────────────────────────────────

/** Entries are stored newest first; the oldest fall off the end. */
export function pruneHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.slice(0, HISTORY_LIMIT);
}

// ─── Storage ────────────────────────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    const entries = data?.[HISTORY_KEY];
    return Array.isArray(entries) ? (entries as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

/** Best-effort: a failed write must never surface into the improve flow. */
export async function appendHistory(entry: HistoryEntry): Promise<void> {
  try {
    const entries = await getHistory();
    await chrome.storage.local.set({ [HISTORY_KEY]: pruneHistory([entry, ...entries]) });
  } catch (err) {
    console.warn('History write failed', err);
  }
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  try {
    const entries = await getHistory();
    await chrome.storage.local.set({ [HISTORY_KEY]: entries.filter(item => item.id !== id) });
  } catch (err) {
    console.warn('History delete failed', err);
  }
}

export async function clearHistory(): Promise<void> {
  try {
    await chrome.storage.local.remove(HISTORY_KEY);
  } catch (err) {
    console.warn('History clear failed', err);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/history.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/shared/history.ts tests/history.test.ts
git commit -m "feat: add opt-in local history module

Capped at 50 entries by a pure pruneHistory. Writes are best-effort and never
surface into the improve flow."
```

---

### Task 4: Extract attachment detection into its own module

This is a pure refactor. No behavior changes, no new tests — correctness is verified by the typechecker and by the manual smoke check in Step 5.

**Files:**
- Create: `src/content/attachments.ts`
- Modify: `src/content/index.ts` (remove lines 145-198 and 401-725, keep `getAttachmentSearchRoot`)

**Interfaces:**
- Consumes: `AttachmentContext`, `AttachmentKind` from `src/shared/types.ts`.
- Produces: `detectAttachmentContext(root: HTMLElement | null): AttachmentContext | undefined` — takes an already-resolved search root instead of resolving one itself.

- [ ] **Step 1: Create the module with the moved code**

Create `src/content/attachments.ts` containing, moved verbatim from `src/content/index.ts`:

- the constants `ATTACHMENT_ELEMENT_SELECTOR`, `ATTACHMENT_CARD_SELECTOR`, `ATTACHMENT_EVIDENCE_PATTERN`, `UPLOAD_ONLY_PATTERN` (currently lines 145-198)
- the functions `collectAttachmentElements`, `queryAttachmentElements`, `isAttachmentEvidenceElement`, `getAttachmentElementKey`, `closestAttachmentPreviewGroup`, `hasAttachmentPreviewMedia`, `hasAttachmentPreviewEvidence`, `closestAttachmentCard`, `closestWithinRoot`, `isReasonableAttachmentCard`, `matchesSelector`, `isVisibleElement`, `hasBlobMedia`, `getAttachmentTextBlob`, `inferAttachmentKind`, `uniqueAttachmentKinds`, `formatAttachmentSummary`, `formatAttachmentPart` (currently lines 437-725)

Header and new entry point:

```ts
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
```

Every other moved function stays module-private (no `export`).

- [ ] **Step 2: Update the caller in the content script**

In `src/content/index.ts`, add to the imports:

```ts
import { detectAttachmentContext } from './attachments';
```

Delete the old `detectAttachmentContext` (lines 401-415) and the moved helpers. Keep `getAttachmentSearchRoot` where it is — it reads `lastCaptureTarget` / `lastActiveEditable` and calls `getActiveEditable`, `getVisualContainer`, and `isUsableVisualContainer`, all of which stay in `index.ts`. Change the one call site inside `buildTextSnapshot`:

```ts
  const attachmentContext = detectAttachmentContext(getAttachmentSearchRoot(target));
```

- [ ] **Step 3: Run the typechecker**

Run: `npm run typecheck`
Expected: no output, exit 0. If it reports an unused function in `index.ts`, that function was part of the move — delete it from `index.ts`.

- [ ] **Step 4: Build and verify the guard**

Run: `npm run build`
Expected: `content script guard passed`. The new module is inlined, so `dist/content.js` still has no imports.

- [ ] **Step 5: Manual smoke check**

Load `dist/` at `chrome://extensions`, open ChatGPT, attach an image, type `improve it`, click the watermelon button. Expected: the result is an image-improvement prompt, not an OCR or analysis prompt — i.e. attachment detection still fires.

- [ ] **Step 6: Commit**

```bash
git add src/content/attachments.ts src/content/index.ts
git commit -m "refactor: extract attachment detection into attachments.ts

detectAttachmentContext now takes a resolved root; getAttachmentSearchRoot
stays in index.ts with the module state it reads. No behavior change."
```

---

### Task 5: Gate the floating button on settings

**Files:**
- Modify: `src/content/index.ts` (imports, new module state, `updateFloatingButton`)

**Interfaces:**
- Consumes: `getSettings`, `onSettingsChanged`, `isHostDisabled`, `DEFAULT_SETTINGS`, `Settings` from `src/shared/settings.ts`.
- Produces: module-level `currentSettings: Settings` inside `src/content/index.ts`, read synchronously by Tasks 6 and 7.

- [ ] **Step 1: Add the settings cache**

In `src/content/index.ts`, add to the imports:

```ts
import {
  DEFAULT_SETTINGS,
  getSettings,
  isHostDisabled,
  onSettingsChanged,
  type Settings,
} from '@/shared/settings';
```

Add below the existing module state declarations (near `let floatingTimer`):

```ts
// The floating-button check runs on every debounced focus/input/scroll event and
// cannot await a storage read, so settings are cached in memory and refreshed
// through onSettingsChanged.
let currentSettings: Settings = DEFAULT_SETTINGS;

void getSettings().then((settings) => {
  currentSettings = settings;
  scheduleFloatingUpdate();
});

onSettingsChanged((settings) => {
  currentSettings = settings;
  if (isFloatingAllowed()) {
    scheduleFloatingUpdate();
  } else {
    hideFloatingButton();
  }
});

function isFloatingAllowed(): boolean {
  return currentSettings.floatingButton && !isHostDisabled(currentSettings, window.location.hostname);
}
```

- [ ] **Step 2: Gate the button**

In `updateFloatingButton` (currently line 1517), insert the check as the first statement of the function body, before the existing `if (busyState)` check:

```ts
  if (!isFloatingAllowed()) {
    hideFloatingButton();
    return;
  }
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 4: Manual verification**

Load `dist/`, open any page with a textarea, type 30+ characters containing "write". Expected: the watermelon button appears. Then in a DevTools console on the extension's service worker run:

```js
chrome.storage.sync.set({ settings: { floatingButton: false } })
```

Expected: the button disappears from the open page immediately, with no reload. Set it back to `true` and confirm it returns.

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "feat: gate the floating button on settings

Global toggle and per-host disable, cached in memory and updated live via
chrome.storage.onChanged. Context menu and Alt+I are unaffected."
```

---

### Task 6: Undo on the success toast

**Files:**
- Modify: `src/content/index.ts` (`showToast`, new snapshot helpers, both replace call sites)

**Interfaces:**
- Consumes: `currentSettings` from Task 5, existing `getMutationTarget`, `setNativeValue`, `dispatchTextEvents`, `isFieldBlocked`.
- Produces: `showToast(message, tone, action?)` with `action?: { label: string; onClick: () => void }`.

- [ ] **Step 1: Add the snapshot helpers**

In `src/content/index.ts`, add above `replaceText` (currently line 805):

```ts
// ─── Undo Snapshot ──────────────────────────────────────────────────────────────

type UndoSnapshot = {
  target: HTMLInputElement | HTMLTextAreaElement;
  value: string;
};

/**
 * Snapshot the whole field before mutating. Restoring the captured *selection*
 * instead would wipe the rest of the field: by undo time the selection is
 * collapsed, so replaceText() would overwrite everything.
 *
 * contenteditable is deliberately unsupported — restoring through innerText
 * would flatten rich content.
 */
function captureUndoSnapshot(): UndoSnapshot | null {
  const target = getMutationTarget();
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return { target, value: target.value };
  }

  return null;
}

function restoreUndoSnapshot(snapshot: UndoSnapshot): boolean {
  const { target, value } = snapshot;
  if (!document.contains(target) || isFieldBlocked(target)) return false;

  setNativeValue(target, value);
  target.setSelectionRange(value.length, value.length);
  dispatchTextEvents(target);
  return true;
}

function showImprovedToast(snapshot: UndoSnapshot | null) {
  if (!snapshot) {
    showToast('Prompt improved in place.', 'success');
    return;
  }

  showToast('Prompt improved in place.', 'success', {
    label: 'Undo',
    onClick: () => {
      if (restoreUndoSnapshot(snapshot)) {
        showToast('Reverted to your original text.', 'info');
      } else {
        showToast('Could not undo — the field changed.', 'error');
      }
    },
  });
}
```

- [ ] **Step 2: Give showToast an optional action**

Replace the signature and the two markup sections of `showToast` (currently line 1742). Change the signature to:

```ts
function showToast(
  message: string,
  tone: 'success' | 'error' | 'info' = 'info',
  action?: { label: string; onClick: () => void },
) {
```

Add to the `<style>` block inside the toast template, after the `.dot` rule:

```css
      .action {
        margin-left: 4px;
        padding: 4px 10px;
        border: 1px solid ${accent};
        border-radius: 999px;
        background: transparent;
        color: #fffdf8;
        cursor: pointer;
        font: inherit;
        font-weight: 650;
        flex: 0 0 auto;
      }
      .action:hover { background: rgba(255, 253, 248, 0.12); }
```

Then, after the existing `if (messageEl) messageEl.textContent = message;`, add:

```ts
  if (action) {
    const button = document.createElement('button');
    button.className = 'action';
    button.type = 'button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.onClick();
    });
    root.querySelector('.toast')?.appendChild(button);
  }
```

- [ ] **Step 3: Snapshot before the two in-place replacements**

In `improveActiveField` (currently line 1624), inside the `IMPROVE_RESPONSE` branch, replace:

```ts
      if (!stopBusyState(requestId)) return;
      replaceText(response.payload.result.optimized_prompt);
      showToast('Prompt improved in place.', 'success');
```

with:

```ts
      if (!stopBusyState(requestId)) return;
      const snapshot = captureUndoSnapshot();
      replaceText(response.payload.result.optimized_prompt);
      showImprovedToast(snapshot);
```

In the `chrome.runtime.onMessage` handler's `IMPROVE_RESPONSE` case (currently line 1851), replace:

```ts
        const success = replaceText(message.payload.result.optimized_prompt);
        if (!success) {
          showToast('Could not replace text in this field.', 'error');
        } else {
          showToast('Prompt improved in place.', 'success');
        }
```

with:

```ts
        const snapshot = captureUndoSnapshot();
        const success = replaceText(message.payload.result.optimized_prompt);
        if (!success) {
          showToast('Could not replace text in this field.', 'error');
        } else {
          showImprovedToast(snapshot);
        }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 5: Manual verification — the selection case**

This is the case the snapshot exists for. In a page textarea, type:

```
Keep this first paragraph exactly as it is.

write a blog post about cats
```

Select only the last line, right-click → Improve with Bhai Thik Kor. When the toast appears, click **Undo**.
Expected: the textarea returns to the exact two-paragraph text above — the first paragraph is still there.

- [ ] **Step 6: Manual verification — contenteditable has no undo**

Repeat on a `contenteditable` editor (Notion, or ChatGPT's composer).
Expected: the improve works and the toast appears **without** an Undo button.

- [ ] **Step 7: Commit**

```bash
git add src/content/index.ts
git commit -m "feat: add undo to the in-place improve toast

Restores a full-field snapshot taken before mutation. Offered only for input
and textarea; contenteditable would be flattened by an innerText restore."
```

---

### Task 7: Preview mode

**Files:**
- Modify: `src/content/index.ts` (`improveActiveField`, `IMPROVE_RESPONSE` handler)

**Interfaces:**
- Consumes: `currentSettings` (Task 5), `showResultOverlay` (existing), `captureUndoSnapshot` / `showImprovedToast` (Task 6).
- Produces: nothing new.

- [ ] **Step 1: Branch in improveActiveField**

In `improveActiveField`, replace the three lines added in Task 6:

```ts
      if (!stopBusyState(requestId)) return;
      const snapshot = captureUndoSnapshot();
      replaceText(response.payload.result.optimized_prompt);
      showImprovedToast(snapshot);
```

with:

```ts
      if (!stopBusyState(requestId)) return;

      if (currentSettings.improveBehavior === 'preview') {
        showResultOverlay(response.payload.result, text);
        return;
      }

      const snapshot = captureUndoSnapshot();
      replaceText(response.payload.result.optimized_prompt);
      showImprovedToast(snapshot);
```

- [ ] **Step 2: Branch in the message handler**

In the `IMPROVE_RESPONSE` case, replace the block from Task 6 with:

```ts
        if (currentSettings.improveBehavior === 'preview') {
          showResultOverlay(message.payload.result, message.payload.originalText || '');
          return false;
        }

        const snapshot = captureUndoSnapshot();
        const success = replaceText(message.payload.result.optimized_prompt);
        if (!success) {
          showToast('Could not replace text in this field.', 'error');
        } else {
          showImprovedToast(snapshot);
        }
```

Note: the existing `closeOverlay()` call earlier in this case runs before the branch, which is correct — it clears any stale card before the new one is rendered.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 4: Manual verification**

In the service worker console:

```js
chrome.storage.sync.set({ settings: { improveBehavior: 'preview' } })
```

Then improve some text via the watermelon button and again via the context menu.
Expected both times: the field is left untouched and the Shadow DOM card appears with Copy / Replace / Insert / Guide / Website. Clicking Replace applies the text. Set `improveBehavior` back to `'replace'` and confirm in-place behavior returns.

- [ ] **Step 5: Commit**

```bash
git add src/content/index.ts
git commit -m "feat: add preview mode for in-place improve

Routes the result to the existing overlay card instead of mutating the field.
Replace stays the default."
```

---

### Task 8: Options page

**Files:**
- Create: `src/options/index.html`
- Create: `src/options/index.ts`
- Create: `src/options/styles.css`
- Modify: `vite.config.ts` (add the `options` entry)
- Modify: `public/manifest.json` (add `options_ui`)

**Interfaces:**
- Consumes: everything exported by `src/shared/settings.ts` and `src/shared/history.ts`.
- Produces: a page at `src/options/index.html`, openable with `chrome.runtime.openOptionsPage()` and anchor-linkable at `#privacy` (used by Task 10).

- [ ] **Step 1: Add the Vite entry and the manifest key**

In `vite.config.ts`, add to `input`:

```ts
        options: resolve(__dirname, 'src/options/index.html'),
```

In `public/manifest.json`, add after the `"action"` block:

```json
  "options_ui": {
    "page": "src/options/index.html",
    "open_in_tab": true
  },
```

Vite preserves the HTML source path, so the page builds to `dist/src/options/index.html` — the same shape as `default_popup: "src/popup/index.html"`.

- [ ] **Step 2: Write the markup**

Create `src/options/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bhai Thik Kor — Settings</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <main class="page">
    <header class="page-header">
      <span class="logo-icon">🍉</span>
      <h1>Bhai Thik Kor Settings</h1>
    </header>

    <section class="card" id="general">
      <h2>General</h2>

      <label class="row">
        <span>
          <strong>Floating button</strong>
          <small>Show the watermelon button next to text boxes that look like prompts.</small>
        </span>
        <input type="checkbox" id="opt-floating">
      </label>

      <fieldset class="row-block">
        <legend><strong>When you improve text</strong></legend>
        <label class="radio">
          <input type="radio" name="behavior" value="replace" id="opt-behavior-replace">
          <span>Replace in place <small>Fastest. Undo is offered afterwards.</small></span>
        </label>
        <label class="radio">
          <input type="radio" name="behavior" value="preview" id="opt-behavior-preview">
          <span>Show the result card first <small>Nothing changes until you click Replace.</small></span>
        </label>
      </fieldset>

      <p class="hint">
        Shortcuts: <kbd>Alt</kbd>+<kbd>I</kbd> improves the selected or focused text,
        <kbd>Alt</kbd>+<kbd>B</kbd> opens the extension.
        <a href="#" id="opt-shortcuts-link">Change shortcuts</a>
      </p>
    </section>

    <section class="card" id="sites">
      <h2>Sites</h2>
      <p class="hint">The floating button never appears on these sites. The right-click menu and
        <kbd>Alt</kbd>+<kbd>I</kbd> keep working.</p>
      <form class="add-row" id="opt-host-form">
        <input type="text" id="opt-host-input" placeholder="example.com" autocomplete="off">
        <button type="submit" class="btn">Add</button>
      </form>
      <ul class="list" id="opt-host-list"></ul>
      <p class="empty" id="opt-host-empty">No sites disabled.</p>
    </section>

    <section class="card" id="history">
      <h2>History</h2>
      <label class="row">
        <span>
          <strong>Keep a local history</strong>
          <small>Stores your last 50 prompts on this device only. Off by default.</small>
        </span>
        <input type="checkbox" id="opt-history">
      </label>
      <div id="opt-history-panel" class="hidden">
        <div class="add-row">
          <button type="button" class="btn danger" id="opt-history-clear">Clear all</button>
        </div>
        <ul class="list" id="opt-history-list"></ul>
        <p class="empty" id="opt-history-empty">Nothing saved yet.</p>
      </div>
    </section>

    <section class="card" id="privacy">
      <h2>Privacy</h2>
      <ul class="prose">
        <li>Your text is sent only when you ask for an improvement — never as you type.</li>
        <li>It goes only to bhaithikkor.vercel.app, which improves it and sends it back.</li>
        <li>Page content is never read or uploaded on its own.</li>
        <li>Password, payment, one-time-code, banking, and medical fields are skipped entirely.</li>
        <li>Your text is never added to a website URL.</li>
        <li>History is stored on this device only, and is off unless you turn it on.</li>
      </ul>
      <p class="hint"><a href="https://bhaithikkor.vercel.app/privacy" target="_blank" rel="noopener noreferrer">Full privacy policy</a></p>
    </section>

    <p class="status" id="opt-status" role="status" aria-live="polite"></p>
  </main>

  <script type="module" src="./index.ts"></script>
</body>
</html>
```

- [ ] **Step 3: Write the stylesheet**

Create `src/options/styles.css`. The token block matches `src/popup/styles.css:7-23` so the two surfaces stay visually consistent:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --btk-primary: #6366f1;
  --btk-primary-hover: #4f46e5;
  --btk-bg: #0f172a;
  --btk-card: #1e293b;
  --btk-border: #334155;
  --btk-text: #e2e8f0;
  --btk-muted: #94a3b8;
  --btk-success: #34d399;
  --btk-error: #f87171;
  --btk-radius: 10px;
  --btk-radius-sm: 6px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background: var(--btk-bg);
  color: var(--btk-text);
  font-size: 14px;
  line-height: 1.55;
}

.page { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; display: grid; gap: 16px; }
.page-header { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.page-header h1 { font-size: 20px; font-weight: 700; }
.logo-icon { font-size: 24px; }

.card {
  background: var(--btk-card);
  border: 1px solid var(--btk-border);
  border-radius: var(--btk-radius);
  padding: 18px;
  display: grid;
  gap: 14px;
}
.card h2 { font-size: 15px; font-weight: 700; }

.row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; cursor: pointer; }
.row span { display: grid; gap: 2px; }
.row small, .radio small { display: block; color: var(--btk-muted); font-size: 12px; }
.row input[type="checkbox"] { width: 18px; height: 18px; accent-color: var(--btk-primary); flex: 0 0 auto; margin-top: 2px; }

.row-block { border: 0; display: grid; gap: 8px; }
.row-block legend { margin-bottom: 4px; }
.radio { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
.radio input { accent-color: var(--btk-primary); margin-top: 3px; }

.hint { color: var(--btk-muted); font-size: 12px; }
.hint a, .prose a { color: var(--btk-primary); }
kbd {
  background: var(--btk-bg);
  border: 1px solid var(--btk-border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 11px;
}

.add-row { display: flex; gap: 8px; }
.add-row input {
  flex: 1;
  background: var(--btk-bg);
  border: 1px solid var(--btk-border);
  border-radius: var(--btk-radius-sm);
  color: var(--btk-text);
  font: inherit;
  padding: 8px 10px;
}
.add-row input:focus { outline: none; border-color: var(--btk-primary); }

.btn {
  background: var(--btk-primary);
  border: 0;
  border-radius: var(--btk-radius-sm);
  color: white;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  padding: 8px 14px;
}
.btn:hover { background: var(--btk-primary-hover); }
.btn.danger { background: transparent; border: 1px solid var(--btk-border); color: var(--btk-error); }
.btn.link { background: transparent; border: 0; color: var(--btk-muted); padding: 2px 6px; }
.btn.link:hover { color: var(--btk-text); }

.list { list-style: none; display: grid; gap: 8px; }
.list li {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  background: var(--btk-bg);
  border: 1px solid var(--btk-border);
  border-radius: var(--btk-radius-sm);
  padding: 10px 12px;
}
.entry { display: grid; gap: 4px; min-width: 0; }
.entry-meta { color: var(--btk-muted); font-size: 11px; }
.entry-text { white-space: pre-wrap; word-break: break-word; font-size: 12px; }
.entry-actions { display: flex; gap: 4px; flex: 0 0 auto; }

.prose { display: grid; gap: 6px; padding-left: 18px; }
.prose li { list-style: disc; }

.empty { color: var(--btk-muted); font-size: 12px; }
.status { min-height: 20px; font-size: 12px; }
.status.error { color: var(--btk-error); }
.status.success { color: var(--btk-success); }
.hidden { display: none; }
```

- [ ] **Step 4: Write the controller**

Create `src/options/index.ts`:

```ts
/**
 * Options Page Controller
 *
 * Reads and writes user settings and local history. Every write goes through
 * setSetting(), which reports failure so the page can surface it.
 */

import {
  MAX_DISABLED_HOSTS,
  getSettings,
  setSetting,
  type ImproveBehavior,
  type Settings,
} from '@/shared/settings';
import {
  clearHistory,
  deleteHistoryEntry,
  getHistory,
  type HistoryEntry,
} from '@/shared/history';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const optFloating = $<HTMLInputElement>('opt-floating');
const optBehaviorReplace = $<HTMLInputElement>('opt-behavior-replace');
const optBehaviorPreview = $<HTMLInputElement>('opt-behavior-preview');
const optShortcutsLink = $<HTMLAnchorElement>('opt-shortcuts-link');
const optHostForm = $<HTMLFormElement>('opt-host-form');
const optHostInput = $<HTMLInputElement>('opt-host-input');
const optHostList = $<HTMLUListElement>('opt-host-list');
const optHostEmpty = $<HTMLParagraphElement>('opt-host-empty');
const optHistory = $<HTMLInputElement>('opt-history');
const optHistoryPanel = $<HTMLDivElement>('opt-history-panel');
const optHistoryList = $<HTMLUListElement>('opt-history-list');
const optHistoryEmpty = $<HTMLParagraphElement>('opt-history-empty');
const optHistoryClear = $<HTMLButtonElement>('opt-history-clear');
const optStatus = $<HTMLParagraphElement>('opt-status');

let settings: Settings;
let statusTimer: number | undefined;

// ─── Status ─────────────────────────────────────────────────────────────────────

function showStatus(message: string, tone: 'success' | 'error') {
  window.clearTimeout(statusTimer);
  optStatus.textContent = message;
  optStatus.className = `status ${tone}`;
  statusTimer = window.setTimeout(() => {
    optStatus.textContent = '';
    optStatus.className = 'status';
  }, 3000);
}

/** Writes revert the control to the stored value when storage rejects them. */
async function write<K extends keyof Settings>(key: K, value: Settings[K]): Promise<boolean> {
  const ok = await setSetting(key, value);

  if (!ok) {
    showStatus('Could not save. Chrome sync may be disabled or full.', 'error');
    render();
    return false;
  }

  settings = { ...settings, [key]: value };
  return true;
}

// ─── General ────────────────────────────────────────────────────────────────────

optFloating.addEventListener('change', () => {
  void write('floatingButton', optFloating.checked);
});

function onBehaviorChange(value: ImproveBehavior) {
  void write('improveBehavior', value);
}

optBehaviorReplace.addEventListener('change', () => onBehaviorChange('replace'));
optBehaviorPreview.addEventListener('change', () => onBehaviorChange('preview'));

optShortcutsLink.addEventListener('click', (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

// ─── Sites ──────────────────────────────────────────────────────────────────────

function normalizeHost(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';

  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return '';
  }
}

optHostForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const host = normalizeHost(optHostInput.value);
  if (!host) {
    showStatus('Enter a site like example.com', 'error');
    return;
  }

  if (settings.disabledHosts.includes(host)) {
    optHostInput.value = '';
    return;
  }

  if (settings.disabledHosts.length >= MAX_DISABLED_HOSTS) {
    showStatus(`You can disable at most ${MAX_DISABLED_HOSTS} sites.`, 'error');
    return;
  }

  if (await write('disabledHosts', [...settings.disabledHosts, host])) {
    optHostInput.value = '';
    renderHosts();
    showStatus(`Disabled on ${host}.`, 'success');
  }
});

async function removeHost(host: string) {
  if (await write('disabledHosts', settings.disabledHosts.filter(item => item !== host))) {
    renderHosts();
  }
}

function renderHosts() {
  optHostList.innerHTML = '';
  optHostEmpty.classList.toggle('hidden', settings.disabledHosts.length > 0);

  for (const host of settings.disabledHosts) {
    const item = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = host;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn link';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void removeHost(host));

    item.append(label, remove);
    optHostList.appendChild(item);
  }
}

// ─── History ────────────────────────────────────────────────────────────────────

optHistory.addEventListener('change', async () => {
  const enabled = optHistory.checked;
  if (!(await write('historyEnabled', enabled))) return;

  // Turning history off deletes what was stored — an off switch that leaves
  // data behind is not an off switch.
  if (!enabled) await clearHistory();

  optHistoryPanel.classList.toggle('hidden', !enabled);
  await renderHistory();
});

optHistoryClear.addEventListener('click', async () => {
  await clearHistory();
  await renderHistory();
  showStatus('History cleared.', 'success');
});

async function renderHistory() {
  const entries = await getHistory();
  optHistoryList.innerHTML = '';
  optHistoryEmpty.classList.toggle('hidden', entries.length > 0);

  for (const entry of entries) {
    optHistoryList.appendChild(createHistoryItem(entry));
  }
}

function createHistoryItem(entry: HistoryEntry): HTMLLIElement {
  const item = document.createElement('li');

  const body = document.createElement('div');
  body.className = 'entry';

  const meta = document.createElement('div');
  meta.className = 'entry-meta';
  meta.textContent = [new Date(entry.at).toLocaleString(), entry.host, entry.source]
    .filter(Boolean)
    .join(' · ');

  const text = document.createElement('div');
  text.className = 'entry-text';
  text.textContent = entry.optimized;

  body.append(meta, text);

  const actions = document.createElement('div');
  actions.className = 'entry-actions';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn link';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    await navigator.clipboard.writeText(entry.optimized);
    showStatus('Copied.', 'success');
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn link';
  remove.textContent = 'Delete';
  remove.addEventListener('click', async () => {
    await deleteHistoryEntry(entry.id);
    await renderHistory();
  });

  actions.append(copy, remove);
  item.append(body, actions);
  return item;
}

// ─── Init ───────────────────────────────────────────────────────────────────────

function render() {
  optFloating.checked = settings.floatingButton;
  optBehaviorReplace.checked = settings.improveBehavior === 'replace';
  optBehaviorPreview.checked = settings.improveBehavior === 'preview';
  optHistory.checked = settings.historyEnabled;
  optHistoryPanel.classList.toggle('hidden', !settings.historyEnabled);
  renderHosts();
}

async function init() {
  settings = await getSettings();
  render();
  if (settings.historyEnabled) await renderHistory();
}

void init();
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: pass 1 now emits `dist/src/options/index.html` and `dist/options.js`; the guard still passes.

- [ ] **Step 6: Manual verification**

Reload the unpacked extension, right-click the toolbar icon → Options.
Expected: the page opens in a tab. Toggle the floating button off, switch to "Show the result card first", add `example.com` under Sites, remove it, turn history on and off. Reload the page after each change and confirm the control kept its value.

- [ ] **Step 7: Commit**

```bash
git add src/options vite.config.ts public/manifest.json
git commit -m "feat: add options page

General, Sites, History, and Privacy sections over the shared settings and
history modules. Failed writes revert the control and report why."
```

---

### Task 9: "Disable on this site" in the popup footer

**Files:**
- Modify: `src/popup/index.html:147-150` (footer)
- Modify: `src/popup/index.ts` (imports, new handler, init)
- Modify: `src/popup/styles.css` (append the footer-toggle rules)

**Interfaces:**
- Consumes: `getSettings`, `setSetting`, `isHostDisabled`, `MAX_DISABLED_HOSTS` from `src/shared/settings.ts`.
- Produces: nothing new.

- [ ] **Step 1: Add the control to the footer**

In `src/popup/index.html`, replace the footer block:

```html
    <!-- Footer -->
    <footer class="footer">
      <span id="rate-limit-info" class="rate-limit-info"></span>
      <label class="site-toggle hidden" id="site-toggle">
        <input type="checkbox" id="site-toggle-input">
        <span id="site-toggle-label">Disable here</span>
      </label>
    </footer>
```

The static `privacy-note` span is deliberately removed: the options page now carries the full privacy statement, and the footer needs the room for the per-site toggle. Leave the `.privacy-note` CSS rule in place — this task does not own it.

- [ ] **Step 2: Style it**

Append to `src/popup/styles.css`:

```css
/* ─── Footer Site Toggle ─────────────────────────────────────────────────────── */

.site-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--btk-muted);
  cursor: pointer;
  font-size: 11px;
}

.site-toggle input {
  width: 13px;
  height: 13px;
  accent-color: var(--btk-primary);
}

.site-toggle:hover { color: var(--btk-text); }
```

- [ ] **Step 3: Wire it up**

In `src/popup/index.ts`, add to the imports:

```ts
import { MAX_DISABLED_HOSTS, getSettings, isHostDisabled, setSetting } from '@/shared/settings';
```

Add to the DOM element block:

```ts
const siteToggle = $<HTMLLabelElement>('site-toggle');
const siteToggleInput = $<HTMLInputElement>('site-toggle-input');
const siteToggleLabel = $<HTMLElement>('site-toggle-label');
```

Add a new section before `// ─── Init ───`:

```ts
// ─── Site Toggle ────────────────────────────────────────────────────────────────

let activeHost = '';

async function initSiteToggle() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  try {
    activeHost = new URL(tab.url).hostname;
  } catch {
    return;
  }

  if (!activeHost) return;

  const settings = await getSettings();
  siteToggleInput.checked = isHostDisabled(settings, activeHost);
  siteToggleLabel.textContent = `Disable on ${activeHost}`;
  siteToggle.classList.remove('hidden');
}

async function handleSiteToggle() {
  const settings = await getSettings();
  const disabled = siteToggleInput.checked;
  const hosts = settings.disabledHosts.filter(host => host !== activeHost);

  if (disabled && hosts.length >= MAX_DISABLED_HOSTS) {
    siteToggleInput.checked = false;
    showActionStatus(`You can disable at most ${MAX_DISABLED_HOSTS} sites.`, 'error');
    return;
  }

  const ok = await setSetting('disabledHosts', disabled ? [...hosts, activeHost] : hosts);

  if (!ok) {
    siteToggleInput.checked = !disabled;
    showActionStatus('Could not save that setting.', 'error');
    return;
  }

  showActionStatus(
    disabled ? `Floating button off for ${activeHost}.` : `Floating button on for ${activeHost}.`,
    'success',
  );
}
```

In `init()`, add alongside the other listener registrations:

```ts
  siteToggleInput.addEventListener('change', handleSiteToggle);
  void initSiteToggle();
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 5: Manual verification**

Open a normal site with a textarea, confirm the watermelon button appears, then open the popup and tick "Disable on <host>".
Expected: the checkbox label names the current host; the button disappears from the page immediately (no reload); the host now appears in the options page's Sites list. Untick and confirm it returns.

- [ ] **Step 6: Commit**

```bash
git add src/popup/index.html src/popup/index.ts src/popup/styles.css
git commit -m "feat: add a per-site disable toggle to the popup footer

Acts on the active tab's hostname and writes the same disabledHosts list the
options page manages."
```

---

### Task 10: History writes and first-run

**Files:**
- Modify: `src/background/index.ts` (imports, `onInstalled`, both improve handlers)

**Interfaces:**
- Consumes: `appendHistory`, `HistoryEntry` from `src/shared/history.ts`; `getSettings`, `setSetting` from `src/shared/settings.ts`.
- Produces: nothing new.

- [ ] **Step 1: Add the imports**

In `src/background/index.ts`:

```ts
import { appendHistory, type HistoryEntry } from '@/shared/history';
import { getSettings, setSetting } from '@/shared/settings';
```

- [ ] **Step 2: Open the options page on first install**

Replace the existing `chrome.runtime.onInstalled` listener (currently lines 50-56):

```ts
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
```

- [ ] **Step 3: Add the single history writer**

Add a new section near the other helpers in `src/background/index.ts`:

```ts
// ─── History ────────────────────────────────────────────────────────────────────

/**
 * The background worker sees every generate response from every surface, so it
 * is the only history writer. Two tabs writing the same storage key would race.
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
```

- [ ] **Step 4: Call it from both success paths**

In `handleImproveFromMessage`, after the successful `sendResponse({ type: 'IMPROVE_RESPONSE', ... })`:

```ts
    void recordHistory(trimmed, result.optimized_prompt, source);
```

In `handleImproveRequest`, after the successful `chrome.tabs.sendMessage(... 'IMPROVE_RESPONSE' ...)`:

```ts
    void recordHistory(trimmed, result.optimized_prompt, source, tabId);
```

Both are fire-and-forget: a history failure must never delay or break the improve response.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 6: Manual verification**

Turn history on in the options page. Improve text from the popup, then from a page via the watermelon button. Reload the options page.
Expected: two entries, newest first; the page-originated one shows a hostname, the popup one does not. Turn history off, reload, turn it back on: the list is empty.

For first run: remove the extension, load `dist/` fresh.
Expected: the options page opens automatically at the Privacy section, exactly once.

- [ ] **Step 7: Commit**

```bash
git add src/background/index.ts
git commit -m "feat: record opt-in history and open options on first install

The background worker is the only history writer, so concurrent tabs cannot
race on the storage key."
```

---

### Task 11: Test the existing prompt heuristics

These functions already ship and already shape every generated prompt; they have never been tested. This task adds coverage without changing behavior.

**Files:**
- Modify: `src/shared/prompt-quality.ts` (add `export` to four functions)
- Modify: `src/background/index.ts` (add `export` to one function)
- Create: `tests/prompt-quality.test.ts`

**Interfaces:**
- Consumes: existing internals.
- Produces: `fitPromptToBudget`, `getOutputWordBudget`, `looksStructured`, `getDomainHint` exported from `src/shared/prompt-quality.ts`; `looksLikeShortImageEditCommand` exported from `src/background/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `tests/prompt-quality.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  fitPromptToBudget,
  getDomainHint,
  getOutputWordBudget,
  looksStructured,
} from '../src/shared/prompt-quality';
import { PROMPT_MAX_CHARS } from '../src/shared/constants';

describe('fitPromptToBudget', () => {
  it('leaves a short prompt untouched', () => {
    const result = fitPromptToBudget('write a poem');
    expect(result.prompt).toBe('write a poem');
    expect(result.wasTrimmed).toBe(false);
  });

  it('leaves a prompt at exactly the limit untouched', () => {
    const result = fitPromptToBudget('x'.repeat(PROMPT_MAX_CHARS));
    expect(result.wasTrimmed).toBe(false);
  });

  it('trims an oversized prompt to within the limit', () => {
    const result = fitPromptToBudget('x'.repeat(PROMPT_MAX_CHARS + 5000));
    expect(result.wasTrimmed).toBe(true);
    expect(result.prompt.length).toBeLessThanOrEqual(PROMPT_MAX_CHARS);
  });

  it('keeps the head and the tail of an oversized prompt', () => {
    const body = 'M'.repeat(PROMPT_MAX_CHARS + 5000);
    const result = fitPromptToBudget(`HEAD${body}TAIL`);
    expect(result.prompt.startsWith('HEAD')).toBe(true);
    expect(result.prompt.endsWith('TAIL')).toBe(true);
  });
});

describe('getOutputWordBudget', () => {
  it('scales with prompt length', () => {
    expect(getOutputWordBudget('x'.repeat(40))).toBe('60-140');
    expect(getOutputWordBudget('x'.repeat(200))).toBe('120-260');
    expect(getOutputWordBudget('x'.repeat(800))).toBe('250-550');
    expect(getOutputWordBudget('x'.repeat(2000))).toBe('300-700');
  });
});

describe('looksStructured', () => {
  it('detects a framework heading', () => {
    expect(looksStructured('Role: senior engineer\nTask: review code')).toBe(true);
  });

  it('rejects prose that merely mentions a heading word', () => {
    expect(looksStructured('my role at work is hard')).toBe(false);
  });
});

describe('getDomainHint', () => {
  it('routes code prompts to the web/app hint', () => {
    expect(getDomainHint('build a react app')).toMatch(/web\/app\/code/);
  });

  it('routes writing prompts to the copy hint', () => {
    expect(getDomainHint('draft an email to my landlord')).toMatch(/writing or copy/);
  });

  it('routes design prompts to the design hint', () => {
    expect(getDomainHint('make a logo for my bakery')).toMatch(/design tasks/);
  });

  it('routes analysis prompts to the analysis hint', () => {
    expect(getDomainHint('summarize this research paper')).toMatch(/analysis tasks/);
  });

  it('falls back when no domain matches', () => {
    expect(getDomainHint('hello there friend')).toMatch(/Choose the expert role/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/prompt-quality.test.ts`
Expected: FAIL — `fitPromptToBudget is not exported`.

- [ ] **Step 3: Export the four functions**

In `src/shared/prompt-quality.ts`, add `export` to the declarations of `fitPromptToBudget` (line 29), `getOutputWordBudget` (line 76), `looksStructured` (line 83), and `getDomainHint` (line 88). Change nothing else in the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/prompt-quality.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Write the failing image-command tests**

Create `tests/image-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { looksLikeShortImageEditCommand } from '../src/background/index';

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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/image-command.test.ts`
Expected: FAIL — importing `src/background/index.ts` evaluates its top-level `chrome.runtime.onInstalled.addListener(...)`, so the error is `chrome is not defined`, not a missing export.

- [ ] **Step 7: Move the heuristic to a testable module**

Because `src/background/index.ts` registers Chrome listeners at module scope, it cannot be imported by a test. Move the two pure functions instead. Create `src/shared/image-command.ts`:

```ts
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
```

Delete `looksLikeShortImageEditCommand` from `src/background/index.ts` (currently lines 371-383) and import it instead:

```ts
import { looksLikeShortImageEditCommand } from '@/shared/image-command';
```

Update the test's import:

```ts
import { looksLikeShortImageEditCommand } from '../src/shared/image-command';
```

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS, 4 files, 30 tests.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: passes, `content script guard passed`.

- [ ] **Step 10: Commit**

```bash
git add src/shared/prompt-quality.ts src/shared/image-command.ts src/background/index.ts tests/
git commit -m "test: cover the prompt-quality and image-command heuristics

Moves looksLikeShortImageEditCommand into src/shared so it can be imported
without evaluating the background worker's listener registrations."
```

---

### Task 12: Manual test checklist, version bump, packaging

**Files:**
- Create: `docs/manual-test-checklist.md`
- Modify: `public/manifest.json` (version)
- Modify: `package.json` (version, `package` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run package` → `bhai-thik-kor-1.0.0.zip` at the repo root.

- [ ] **Step 1: Write the checklist**

Create `docs/manual-test-checklist.md`:

```markdown
# Manual Test Checklist

Run before every store submission and after any change to `src/content/`.
Build with `npm run build`, then load `dist/` at `chrome://extensions`.

## Per site

Sites: ChatGPT, Claude, Gemini, Gmail, LinkedIn, Notion, a plain `<textarea>`
test page, a `contenteditable` test page.

- [ ] Floating watermelon button appears next to a prompt-like text box
- [ ] Clicking it locks the field with the gradient border, then replaces the text
- [ ] Undo restores the original text exactly (input/textarea only)
- [ ] `contenteditable` shows the success toast with no Undo button
- [ ] Right-click → "Improve with Bhai Thik Kor" works on a selection
- [ ] `Alt+I` improves the focused field
- [ ] `Alt+B` opens the popup
- [ ] With `improveBehavior: preview`, the result card appears and the field is untouched
- [ ] With the site disabled, the button never appears, but the context menu still works

## Guards

- [ ] Password field: no button; context menu reports a protected field
- [ ] A checkout or `/payment` URL: refuses to send
- [ ] Blocked field: Copy works in the popup, Replace reports it cannot apply

## Popup

- [ ] Normal Mode returns a prompt with model routing
- [ ] Guided Mode asks questions and generates from the answers
- [ ] Tweak refines the result
- [ ] Copy, Replace, Insert Below each work against the active tab
- [ ] "Disable on <host>" names the current site and takes effect immediately
- [ ] Rate-limit line shows a remaining count

## Options

- [ ] Every control persists across a page reload
- [ ] Turning history off empties the stored list
- [ ] Adding and removing a site updates the popup toggle for that site

## Failure paths

- [ ] Offline: "Could not connect to Bhai Thik Kor"
- [ ] Empty or 2-character input: asks for more detail
- [ ] Interrupted improve: the field unlocks within 50 seconds
```

- [ ] **Step 2: Bump the version in both files**

In `public/manifest.json`: `"version": "1.0.0"`.
In `package.json`: `"version": "1.0.0"`.

- [ ] **Step 3: Add the package script**

Add to `scripts` in `package.json`, after `"clean"`:

```json
    "package": "npm run build && cd dist && zip -r ../bhai-thik-kor-1.0.0.zip . -x '*.map'"
```

- [ ] **Step 4: Ignore the artifact**

Add to `.gitignore`:

```
*.zip
```

- [ ] **Step 5: Verify packaging**

Run: `npm run package`
Expected: `bhai-thik-kor-1.0.0.zip` at the repo root. Confirm its contents:

Run: `unzip -l bhai-thik-kor-1.0.0.zip`
Expected: `manifest.json` at the archive root (not nested in a folder), plus `background.js`, `content.js`, `popup.js`, `options.js`, `icons/`, `assets/`, `src/popup/index.html`, `src/options/index.html`.

- [ ] **Step 6: Commit**

```bash
git add docs/manual-test-checklist.md public/manifest.json package.json .gitignore
git commit -m "chore: bump to 1.0.0, add packaging and manual test checklist"
```

---

### Task 13: Privacy policy and store listing copy

The policy page lives in the **web app repo** (`../prompt-generator`), not this one. It is committed there separately.

**Files:**
- Create: `../prompt-generator/app/privacy/page.tsx`
- Create: `docs/store-listing.md` (in this repo)

**Interfaces:**
- Consumes: nothing.
- Produces: `https://bhaithikkor.vercel.app/privacy`, linked from the options page's Privacy section (Task 8) and required by the store listing.

- [ ] **Step 1: Write the policy page**

Create `../prompt-generator/app/privacy/page.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Bhai Thik Kor",
  description:
    "What the Bhai Thik Kor website and browser extension send, store, and never collect.",
};

const UPDATED = "10 August 2026";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 prose prose-invert">
      <h1>Privacy Policy</h1>
      <p>Last updated: {UPDATED}</p>

      <h2>What we send</h2>
      <p>
        Bhai Thik Kor improves prompts. When you ask for an improvement — by clicking a button,
        using the right-click menu, or pressing the keyboard shortcut — the text you selected or
        typed is sent to our server at bhaithikkor.vercel.app, improved by an AI model, and sent
        back to you.
      </p>
      <p>
        Nothing is sent until you ask. The extension does not log keystrokes, does not read page
        content on its own, and does not send anything in the background.
      </p>

      <h2>What we skip</h2>
      <p>
        The extension refuses to read password, payment card, one-time-code, banking, and medical
        fields, along with pages whose address looks like a login, checkout, banking, or medical
        portal. Disabled and read-only fields are skipped too.
      </p>

      <h2>What we store</h2>
      <p>
        We do not keep your prompts. Our servers log only operational data — which endpoint was
        called, whether it succeeded, how long it took, how many characters were sent, and the
        coarse type of any error. That data contains no prompt text and expires after 14 days.
      </p>
      <p>
        We use your IP address to enforce rate limits (50 improvements per day). It is not stored
        alongside your prompt text and is not used to build a profile.
      </p>
      <p>
        The extension&apos;s optional history is off by default. When you turn it on, your last 50
        prompts are stored on your own device using the browser&apos;s local extension storage.
        They never reach our servers and never sync between devices. Turning history off deletes
        them.
      </p>

      <h2>What we never do</h2>
      <ul>
        <li>We do not sell your data.</li>
        <li>We do not use your prompts for advertising or tracking.</li>
        <li>We do not require an account, and we do not know who you are.</li>
        <li>We do not put your prompt text into any website address.</li>
      </ul>

      <h2>AI providers</h2>
      <p>
        To improve a prompt we pass your text to one of our model providers — Groq, Google
        (Gemini), or OpenRouter — under their API terms. We send only your prompt text and any
        clarifications you provided.
      </p>

      <h2>Permissions the extension asks for</h2>
      <ul>
        <li>
          <strong>Access to sites you visit</strong> — so the improve button can appear next to the
          text box you are writing in. You can turn this off globally or per site in the
          extension&apos;s settings.
        </li>
        <li>
          <strong>Storage</strong> — to remember your settings and, if you enable it, your local
          history.
        </li>
        <li>
          <strong>Context menu</strong> — for the right-click &quot;Improve with Bhai Thik
          Kor&quot; entry.
        </li>
      </ul>

      <h2>Contact</h2>
      <p>
        Questions about this policy: <a href="mailto:idublinfourir@gmail.com">idublinfourir@gmail.com</a>
      </p>
    </main>
  );
}
```

- [ ] **Step 2: Verify it renders**

Run: `cd ../prompt-generator && npm run dev`
Open `http://localhost:3000/privacy`.
Expected: the page renders with the site's dark theme and no console errors. Stop the dev server.

- [ ] **Step 3: Commit it in the web app repo**

```bash
cd ../prompt-generator
git add app/privacy/page.tsx
git commit -m "feat: add privacy policy page for the browser extension"
```

Deploy that repo so `https://bhaithikkor.vercel.app/privacy` is live before submitting the extension — the store requires a reachable policy URL.

- [ ] **Step 4: Write the listing copy**

Create `docs/store-listing.md` in the extension repo:

```markdown
# Chrome Web Store Listing

## Name

Bhai Thik Kor — Prompt Improver

## Short description (132 char max)

Turn rough ideas into clear AI prompts, right where you write. Improve any text box in one click.

## Single purpose

Bhai Thik Kor improves the text a user is writing into a stronger AI prompt, in the text box
they are already using.

## Detailed description

You know what you want. Writing it as a good prompt is the annoying part.

Bhai Thik Kor sits quietly next to your text box. When you want help, click the watermelon
button, right-click your selection, or press Alt+I. Your rough sentence comes back as a
complete, structured prompt — with a role, context, constraints, and an output format — ready
to send.

- Works anywhere you type: ChatGPT, Claude, Gemini, Gmail, LinkedIn, Notion, plain text boxes.
- Improve in place, or preview the result first — your choice in settings.
- Undo puts your original text back.
- Guided Mode asks a few short questions when your idea is still fuzzy.
- Suggests which AI model suits the job, across open-source, free, and paid tiers.
- Free, no account needed.

Privacy first. Your text is sent only when you ask for an improvement — never as you type.
The extension skips password, payment, one-time-code, banking, and medical fields. It never
reads page content on its own, and history is off by default and stored only on your device.

It improves how you ask. You still review what the AI writes back.

## Permission justifications

- **Host permission `https://bhaithikkor.vercel.app/*`** — the extension sends the user's text to
  our own backend, which returns the improved prompt. This is the extension's core function.
- **`<all_urls>` content script** — the improve button and in-place text replacement must work in
  whatever text box the user is writing in, which can be on any site. The script only reads text
  after an explicit user action. Users can disable it globally or per site in the extension's
  settings.
- **`activeTab`** — reads the selected text in the current tab when the user triggers an improve
  from the context menu or keyboard shortcut.
- **`scripting`** — injects the content script into the active tab when it is not already present,
  so an improve triggered right after install works without a page reload.
- **`contextMenus`** — adds the "Improve with Bhai Thik Kor" right-click entry.
- **`storage`** — stores the user's settings and, if enabled, their local prompt history.

## Data use disclosure

- **Does the extension collect user data?** Yes.
- **Personal communications** — the extension transmits text the user explicitly submits for
  improvement to the developer's own backend, which is required for the extension's single
  purpose. It is not sold, not used for tracking or advertising, and not retained as prompt text.
- Certifications: not sold to third parties; used only for the single purpose described; not used
  to determine creditworthiness or for lending.

## Screenshots (1280×800)

1. Popup in Normal Mode with a rough idea typed in.
2. Popup result: optimized prompt plus the three model-routing cards.
3. Floating watermelon button beside a composer on a real AI site.
4. In-place improve mid-flight: the field locked with the animated gradient border.
5. Options page showing the settings and the privacy section.

## Promo tile

440×280, watermelon mark on the dark background, tagline "Better prompts, wherever you write."
```

- [ ] **Step 5: Commit in the extension repo**

```bash
cd ../bhai-thik-kor-extension
git add docs/store-listing.md
git commit -m "docs: add Chrome Web Store listing copy and permission justifications"
```

- [ ] **Step 6: Final verification before submission**

Run: `npm test`
Expected: PASS, 4 files, 30 tests.

Run: `npm run package`
Expected: `bhai-thik-kor-1.0.0.zip` written.

Then work through `docs/manual-test-checklist.md` end to end, confirm `https://bhaithikkor.vercel.app/privacy` loads, capture the five screenshots and the promo tile, and upload the zip.

---

## Notes for the implementer

- The manual verification steps are not optional. There is no automated coverage of the DOM behavior, so those steps are the only thing standing between a change and a broken text box on ChatGPT.
- `dist/` is git-ignored. Never commit build output.
- If a task's build step fails with `Cannot find module '@rollup/rollup-<platform>'`, the repo was moved between operating systems: `rm -rf node_modules package-lock.json && npm install`.
- `vite.config.ts` sets `build.emptyDirFirst`, which is not a real Vite option (the correct name is `emptyOutDir`), so `dist/` is never cleared. This is pre-existing and deliberately out of scope. If a stale file confuses a build, run `npm run clean` first.
