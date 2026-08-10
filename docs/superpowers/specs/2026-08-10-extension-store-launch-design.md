# Bhai Thik Kor Extension — Chrome Web Store Launch Design

**Date:** 2026-08-10
**Status:** Approved design, ready for implementation planning
**Scope:** Everything needed to publish v1.0.0 on the Chrome Web Store

## Goal

The extension's core features work: in-place prompt improvement, popup Normal/Guided/Tweak
modes, context menu, keyboard shortcuts, sensitive-field guards. Distribution is the blocker.
This phase adds the user controls and legal/listing material a store submission requires, plus
the build and test scaffolding those controls need.

**Done means:** `npm run build` green, `npm test` green, the manual matrix passing, and a store
submission accepted.

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Permission model | Keep `<all_urls>` content script | The floating button is the product's Grammarly-like value. Justified in review by a user-facing off switch (global and per-site). |
| Settings surface | Full options page, four sections | Requested. Polished, not minimal. |
| Default improve behavior | `replace` (in place), with undo | Preserves the current signature UX; undo defuses the "it overwrote my text" failure mode without slowing everyone down. |
| History | Opt-in, off by default, local only | Prompt text must not leave the machine or sync. |
| Content-script refactor | Extract `attachments.ts` and `floating.ts` only | The rest works and has no tests. Refactor further only when a task touches that code. |
| Settings storage | `chrome.storage.sync` for prefs, `chrome.storage.local` for history | Prefs should follow the profile; history should not. |

Explicitly cut as speculative: a `version` field on the settings schema (nothing to migrate),
and a search box over a 50-entry history list.

## Architecture

### Build (prerequisite for everything else)

`dist/content.js` must stay a classic, self-contained script — `scripts/check-content-script.mjs`
fails the build on any static import/export or shared-chunk import. That guard is why
`src/content/index.ts` currently re-declares `WEBSITE_URL` and `buildWebsiteUrl`. A shared
settings module consumed by content + background + popup + options would be hoisted into
`chunks/` and break it.

Fix by splitting the build into two passes:

- `vite.config.ts` — entries `popup`, `options`, `background`. Shared chunks allowed.
- `vite.content.config.ts` — entry `content` alone, `build.rollupOptions.output.inlineDynamicImports: true`,
  `build.emptyOutDir: false`. Emits one flat `dist/content.js`.

`npm run build` = `tsc --noEmit` → pass 1 → pass 2 → content-script guard. The guard stays
exactly as it is; it is what keeps this honest.

Also add `vitest` as a dev dependency and an `npm test` script. There is no test runner in the
repo today, and the success criteria reference one.

Consequence: the content script may import from `src/shared/`, and the duplicated
`WEBSITE_URL` / `buildWebsiteUrl` in `src/content/index.ts` are deleted.

### Modules

New:

- `src/shared/settings.ts` — typed accessors and change subscription (below).
- `src/shared/history.ts` — read, append-with-prune, clear.
- `src/options/{index.html,index.ts,styles.css}` — options page, reusing the popup's CSS
  custom properties.
- `src/content/attachments.ts` — moved verbatim from `src/content/index.ts` (attachment
  detection, ~300 lines, imported by nothing else today).
- `src/content/floating.ts` — moved: floating button rendering, positioning,
  `looksPromptLike`, and the new settings gate.

Unchanged: the rest of `src/content/index.ts`, `src/background/index.ts`,
`src/shared/api-client.ts`, `src/shared/prompt-quality.ts`, `src/popup/*` (except the one new
footer control).

Manifest: add `options_ui` with `open_in_tab: true`. No new permissions — `storage` is already
declared.

## Settings

```ts
type ImproveBehavior = 'replace' | 'preview';

type Settings = {
  floatingButton: boolean;          // default true
  disabledHosts: string[];          // exact hostnames, default [], capped at 100
  improveBehavior: ImproveBehavior; // default 'replace'
  historyEnabled: boolean;          // default false
  seenWelcome: boolean;             // default false
};
```

`getSettings()` merges stored values over `DEFAULT_SETTINGS`; it never throws and never returns
undefined. `setSetting(key, value)` writes one key. `onSettingsChanged(cb)` wraps
`chrome.storage.onChanged` filtered to the sync area.

### History

```ts
type HistoryEntry = {
  id: string;
  at: number;
  original: string;
  optimized: string;
  source: ImproveSource;
  host: string;
};
```

Stored in `chrome.storage.local` under one key, newest first, pruned to 50 on every append.
Written only when `historyEnabled` is true. Turning history off deletes the stored entries in
the same operation — an off switch that leaves data behind is not an off switch.

## Options page

Single scrollable page, four sections, anchor-linkable (`#privacy` used by first run).

1. **General** — floating button on/off; improve behavior radio (Replace in place / Show result
   card first); keyboard shortcut hints with a link to `chrome://extensions/shortcuts`.
2. **Sites** — list of disabled hostnames, each with a remove button; an add field that accepts
   a hostname.
3. **History** — master toggle; when enabled, the stored entries newest-first, each with copy
   and delete, plus Clear all. No search.
4. **Privacy** — plain-language statement of what is and is not sent, and a link to the hosted
   policy.

The popup gains one control: a "Disable on this site" toggle in the footer acting on the active
tab's hostname. Discoverable where the annoyance happens; the options page manages the
accumulated list.

## Data flow

**Settings in the content script are cached in memory.** The floating-button check runs on every
debounced `focusin`/`input`/`scroll` and cannot await a storage read. The content script
hydrates a module-level `Settings` at injection and keeps it current through
`onSettingsChanged`. Reads are synchronous against that cache. The content script never writes
settings.

**Improve, replace mode:**

```
getSelectedText() → startBusyState(requestId) → background
  → apiGenerate → IMPROVE_RESPONSE{requestId}
  → stopBusyState(requestId) → replaceText(optimized)
  → showToast("Prompt improved in place", 'success', { undo: () => replaceText(original) })
  → background appends a history entry if historyEnabled
```

`showToast` gains an optional third argument for an action button; it stays in
`src/content/index.ts` alongside the busy-state and mutation functions, which are not being
extracted in this phase.

**Improve, preview mode:** identical until the response, then `stopBusyState()` followed by the
existing Shadow DOM result overlay. No mutation until the user clicks Replace or Insert in the
card.

**History has exactly one writer: the background worker.** It already observes every generate
response from every surface, so writing there avoids two tabs racing on the same storage key.
Content and popup never write history; the options page only reads and deletes.

**Disabled hosts suppress automatic UI only.** No floating button, no prompt-likeness detection.
The context menu and `Alt+I` continue to work, because those are unambiguous explicit intent.
The same rule applies when `floatingButton` is false globally.

**First run:** `chrome.runtime.onInstalled` with `reason === 'install'` opens the options page at
`#privacy` and sets `seenWelcome: true`. No modal and no injection into the user's active tab.

**Live propagation:** a settings write fires `onSettingsChanged` in every open tab, so toggling
"Disable on this site" hides the button immediately, with no reload or reinjection.

## Error handling

New failure modes only; existing 429 / 503 / network paths are unchanged.

- **Settings read fails or returns a partial object** — merged over defaults, never throws. A
  broken settings read must not be able to disable improving.
- **`chrome.storage.sync` write fails** (sync disabled, quota) — the options page shows an
  inline message on that control and the in-memory value reverts to what is stored.
  `disabledHosts` is capped at 100 hostnames, well under the 8 KB per-item limit.
- **History write fails** — swallowed and logged, never surfaced. A full `storage.local` must not
  turn a successful improve into a visible error.
- **Undo cannot apply** (field detached, navigated away, now blocked) — `replaceText` already
  returns `false`; the toast says "Could not undo — the field changed." No clipboard fallback,
  no retry.
- **Preview overlay orphaned by navigation** — already covered by `cleanupTransientUi()` on
  re-injection. No new code.

## Testing

**Automated: Vitest, pure functions only.** No jsdom, no `chrome.*` mocking — the ROI on
simulating the extension runtime is not there at this size.

| Under test | Why |
|---|---|
| `getSettings()` merge | Corrupt, partial, and empty storage must yield working defaults |
| `disabledHosts` matching | Decides whether the button appears at all |
| History prune to 50 | An off-by-one here silently grows storage forever |
| `fitPromptToBudget`, `getOutputWordBudget`, `looksStructured`, `getDomainHint` | Existing untested logic that shapes every generated prompt |
| `looksLikeShortImageEditCommand` | Existing heuristic with the trickiest regex in the codebase |

The last two rows require exporting a few functions that are currently module-private in
`src/shared/prompt-quality.ts` and `src/background/index.ts`. That is the only change to those
files, and each export traces to a test.

**Manual: a checklist committed to the repo,** run before submission and after any
content-script change. Sites: ChatGPT, Claude, Gemini, Gmail, LinkedIn, Notion, a plain
`<textarea>`, a `contenteditable`, a password field, a checkout page. Per site: floating button
appears, in-place replace lands, undo restores, preview mode shows the card, disabled-host
silences the button, blocked field refuses replacement.

## Launch assets

- **Privacy policy** — a `/privacy` route on the existing Next.js app (`../prompt-generator`),
  so the policy lives on the product's own domain. States plainly: text is sent only on explicit
  user action, only to `bhaithikkor.vercel.app`, not sold, not used for tracking, not retained as
  full prompts; history is local-only and off by default.
- **Store listing** — single-purpose statement, description, and a justification for each of
  `activeTab`, `contextMenus`, `scripting`, `storage`, the `bhaithikkor.vercel.app` host
  permission, and the `<all_urls>` content script. The `<all_urls>` justification rests on the
  settings page: the automatic UI can be disabled globally or per site.
- **Data-use disclosure** — user-supplied text is transmitted to the developer's own backend to
  provide the extension's core function. Not "no data collected."
- **Screenshots** — five at 1280×800: popup Normal Mode, result with model routing, floating
  button on a real AI site, in-place improve mid-flight showing the gradient border, options
  page. Plus the 440×280 promo tile. Icons already exist at 16/48/128.
- **Version** — bump `manifest.json` and `package.json` to `1.0.0`; add `npm run package` to zip
  `dist/` for upload.

## Out of scope

Side panel, streaming/progressive result rendering, site-specific adapters, URL context via
`/api/extract`, Firefox support, accounts or cross-device sync. None block a Chrome listing.
