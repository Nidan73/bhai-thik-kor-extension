# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

**Bhai Thik Kor Extension** — a Chrome Manifest V3 extension that turns rough text into an
optimized AI prompt, in place, wherever the user writes. It is a thin client: all AI work
happens on the existing Bhai Thik Kor backend (`https://bhaithikkor.vercel.app`). **No provider
API keys ever live in the browser.**

Two related codebases:

| Piece | Location | Role |
|-------|----------|------|
| Extension (this repo) | `.` | MV3 client: popup, content script, background worker |
| Web app + backend | `../prompt-generator` (Next.js App Router, deployed on Vercel) | Owns `/api/*`, prompt engineering, provider pool, rate limits |

Local-only planning docs (git-ignored, do not commit): `PROJECT_PLAN.md`,
`implementation_progress.md` here; `PROJECT_CONTEXT.md` in `../prompt-generator`.
`implementation_progress.md` is **stale** — it stops at the MVP and predates the in-place
rewrite workflow. Trust the source, then `README.md`.

## Commands

```bash
npm install
npm run typecheck    # tsc --noEmit (strict)
npm run dev          # both watch passes (popup/options/background, and content)
npm run dev:content  # content-script pass only
npm test             # vitest run — pure logic only, no chrome.* mocking
npm run build        # typecheck + clean + both passes + content-script guard
npm run package      # build, then zip dist/ to bhai-thik-kor-<version>.zip
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked. There is no test
suite and no linter configured.

`node_modules/` carries a platform-specific rollup binary (`@rollup/rollup-<platform>`). Moving
the repo between OSes makes `vite build` fail with `Cannot find module '@rollup/rollup-...'` —
fix with `rm -rf node_modules package-lock.json && npm install` on the current machine.

## Architecture

```
popup (src/popup)          content script (src/content)      background (src/background)
Normal + Guided + Tweak    capture, guards, in-page UI,      context menu, commands,
                           replace/insert, busy state        API calls
        └────────── chrome.runtime messages ──────────┘ ──────► bhaithikkor.vercel.app/api
```

- **All network calls go through the background service worker.** Content scripts and the
  popup never `fetch()` the API directly — this is what avoids CORS and keeps host
  permissions to `https://bhaithikkor.vercel.app/*`.
- `src/shared/types.ts` holds the single `Message` union. Every runtime message must be a
  member of it; senders use `satisfies Message`.
- `src/shared/api-client.ts` is the only place that talks HTTP.
- `src/shared/prompt-quality.ts` silently appends "quality clarifications" to every
  `/api/generate` call (first-pass quality target, assumption handling, token budget, domain
  hint) and clips over-budget prompts. This is why extension output is stronger than a raw
  API call.

### Build constraints

- **Two Vite passes, both writing into `dist/`.** `vite.config.ts` builds `popup`, `options`,
  and `background` (shared chunks allowed); `vite.content.config.ts` builds `content` alone
  with `inlineDynamicImports` so it emits one flat file. Neither pass may clear `dist/` —
  `npm run build` cleans once up front instead. Manifest and icons come from `public/`.
- **`dist/content.js` must be a classic, self-contained script** — no static `import`/`export`,
  no shared chunk. `scripts/check-content-script.mjs` enforces this after every build. The
  second pass is what lets the content script import from `src/shared/` anyway.
- Background is `"type": "module"`; content script is not.
- `src/shared/settings.ts` (synced prefs) and `src/shared/history.ts` (local, opt-in) are the
  single source of truth for user preferences, read by all four surfaces. Their pure halves —
  `mergeSettings`, `pruneHistory` — hold the logic so tests need no `chrome.*` mocking.

## Backend contract (source of truth: `../prompt-generator/lib/api-schemas.ts`)

| Endpoint | Method | Request | Response | Rate limit |
|----------|--------|---------|----------|------------|
| `/api/generate` | POST | `{ prompt, clarifications: {question,answer}[] }` (max 6, prompt ≤ 4000 chars) | **text stream** whose full body is the JSON `{ optimized_prompt, routing: { open_source, freemium, premium } }` | 50/IP/day |
| `/api/clarify` | POST | `{ prompt }` | plain JSON array of `{ id, question, options[≤4] }` | 3/IP/min |
| `/api/refine` | POST | `{ currentPrompt (≤6000), instruction (≤500) }` | text stream of the refined prompt | 5/IP/min |
| `/api/health` | GET | — | `{ status, checks }` | — |
| `/api/extract` | POST | `{ url }` | URL context (**unused by the extension**) | 5/IP/min |

`generate` and `refine` use `toTextStreamResponse()`, so the client reads the body to
completion and parses at the end (`consumeTextStream`). Rate-limit state comes from
`X-RateLimit-{Limit,Remaining,Reset}`; 429 also carries `Retry-After`. Errors are
`{ error, retryAfter? }` with 429 (limited) / 503 (all providers busy) / 400 (validation).

Mirror limit constants in `src/shared/constants.ts` when the backend schema changes.

## User-facing flows

1. **In-place improve** (primary) — floating 🍉 button next to a focused editable field, the
   `Improve with Bhai Thik Kor` context menu on a selection, or `Alt+I`. The field is locked
   with an animated gradient border while working, then the text is **replaced directly** and
   a toast confirms. `Alt+B` opens the popup.
2. **Popup** — Normal Mode (type → Improve), Guided Mode (`/api/clarify` → answer → generate),
   result actions: Copy / Replace / Insert Below / Tweak (`/api/refine`) / Open Website /
   per-tier model "Try" links.
3. **In-page overlay** (Shadow DOM card) — used for Guided Mode started from the page and for
   showing results/errors; the main improve path replaces text instead of opening it.

Request correlation: each in-place improve carries a `requestId`. A 50 s recovery timer
unlocks the field and adds the id to `ignoredImproveRequestIds`, so a late response can never
overwrite text the user has resumed editing. Preserve that guard when touching the busy-state
or message-handling code.

## Non-negotiable product rules

- Never send text without an explicit user action. No keystroke or page-content collection.
- Never mutate user text except on an explicit improve/replace/insert action.
- Respect the field guards in `src/content/index.ts` (`isFieldBlocked`, `SENSITIVE_*`,
  `BLOCKED_AUTOCOMPLETE`): password/hidden/disabled/readonly inputs, credit-card / OTP /
  banking / medical field names, and login-, payment-, bank-, medical-looking URLs are skipped
  entirely. Blocked field → copy still works, replacement does not.
- Never put prompt text in the website URL. `buildWebsiteUrl()` deliberately ignores the
  prompt and the handoff copies to the clipboard instead.
- No provider secrets, no analytics, no remote code.

## Conventions

- TypeScript strict, ES2022, `@/` → `src/`. Vanilla DOM, no framework.
- Section banner comments (`// ─── Name ───`) separate concerns inside a file.
- In-page UI is Shadow DOM with `:host { all: initial; }` and IDs prefixed `btk-`
  (`btk-overlay-root`, `btk-floating-root`, `btk-toast-root`, `btk-busy-border`,
  `btk-busy-style`). Keep the prefix and clean hosts up on re-injection.
- Build DOM with `createElement` + `textContent` for anything derived from API or page text;
  `innerHTML` is only for static shells.
- Text writes go through `setNativeValue` + `dispatchTextEvents` so React/Vue-controlled
  inputs register the change.
- Brand: watermelon 🍉, green `#2f8f5b` / rose `#e94f57` accents; the web app keeps a
  permanent Free Palestine banner.

## State of the work

Done and working: MV3 scaffold, background API routing with provider errors surfaced,
Normal + Guided + Tweak in the popup, context menu, `Alt+I` / `Alt+B`, floating button with
local prompt-likeness detection, in-place replace with busy lock and stale-response guard,
attachment detection near the composer (feeds hints so an attached image doesn't turn a task
into an OCR/report request), sensitive-field guards, rate-limit display, Shadow DOM overlay
and toasts.

Added for the 1.0.0 store launch (branch `feat/store-launch`): options page (floating-button
toggle, per-site disable, replace-vs-preview, opt-in history), a per-site toggle in the popup
footer, undo on the in-place success toast, preview mode, first-run options tab, Vitest with
30 tests, `npm run package`, and the store listing copy in `docs/store-listing.md`.

Still not built: side panel, streaming/progressive result rendering, site-specific adapters,
URL-context (`/api/extract`) support, and Firefox support (`chrome.*` is used directly).
`content_scripts` matches `<all_urls>` at `document_idle` by design — the settings page is the
review justification, since users can disable the automatic UI globally or per site.

Two things to know before touching the in-page UI: the overlay (`renderOverlayShell`,
`showResultOverlay`, the in-page guided flow) was dead code until preview mode made it
reachable, so it is largely unexercised; and **no DOM behavior has automated coverage** —
`docs/manual-test-checklist.md` is the only verification for it.
