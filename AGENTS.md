# AGENTS.md

Full context lives in [CLAUDE.md](CLAUDE.md) — architecture, backend contract, conventions, and
current state. Read it before changing anything. The rules below are the ones that break the build
or the product if you miss them.

## Non-negotiables

- **`dist/content.js` must stay a classic, self-contained script.** No static `import`/`export`, no
  shared-chunk import. `scripts/check-content-script.mjs` fails the build otherwise. The content
  script is built by its own Vite pass (`vite.content.config.ts`); neither pass may clear `dist/`.
- **All network calls go through the background service worker.** Content scripts and the popup
  never `fetch()` the API. No provider API keys in the browser, ever.
- **Never send text without an explicit user action**, and never mutate user text except on an
  explicit improve/replace/insert. Respect the field guards in `src/content/index.ts`
  (`isFieldBlocked`): password, payment, one-time-code, banking, and medical fields and pages are
  skipped entirely.
- **Never put prompt text in a website URL.** `buildWebsiteUrl()` ignores the prompt by design.
- Every runtime message must be a member of the `Message` union in `src/shared/types.ts`.

## Commands

```bash
npm install
npm run dev      # both watch passes
npm run build    # typecheck + clean + both passes + content-script guard
npm test         # vitest run — pure logic only
npm run package  # build, then zip dist/ for the Chrome Web Store
```

If a build fails with `Cannot find module '@rollup/rollup-<platform>'`, the repo was moved between
operating systems: `rm -rf node_modules package-lock.json && npm install`.

## Verification

There is **no automated coverage of DOM behavior** — Vitest tests pure logic only. Anything touching
`src/content/`, the popup, or the options page must be checked by hand against
`docs/manual-test-checklist.md` with `dist/` loaded at `chrome://extensions`. Do not report such work
as verified on a green build alone.

## Local-only files

`PROJECT_PLAN.md` and `implementation_progress.md` are git-ignored maintainer notes. Do not commit
them, and do not put API keys, provider secrets, or user data in them.
