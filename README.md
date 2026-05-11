# Bhai Thik Kor — Browser Extension

Turn rough ideas into expert AI prompts — wherever you write.

A Grammarly-like Chrome extension that works with the [Bhai Thik Kor](https://bhaithikkor.vercel.app) backend. No API keys in the browser. No keystroke logging. Privacy first.

## Features

- **Normal Mode**: Type a rough idea → get an optimized prompt.
- **Guided Mode**: Answer clarifying questions → get a sharper prompt.
- **Context Menu**: Select text → right-click → "Improve with Bhai Thik Kor".
- **Keyboard Shortcut**: `Ctrl+Shift+B` (Windows/Linux) or `Cmd+Shift+B` (macOS).
- **Actions**: Copy, Replace, Insert Below, Open Website.
- **Model Routing**: See recommended AI models per tier (open source / freemium / premium).

## Tech Stack

- Chrome Manifest V3
- Vite (build tool)
- TypeScript (strict mode)
- Tailwind CSS (popup styling)
- Vanilla DOM (no React)
- Shadow DOM (for future in-page overlay)

## Architecture

```
Background Worker (API calls, context menu, shortcuts)
        ↕ chrome.runtime messages
Content Script (text capture, replace/insert, field guards)
Popup UI (Normal Mode, Guided Mode, results)
```

All API calls route through the background service worker → `bhaithikkor.vercel.app`. No CORS issues.

## Development

```bash
npm install
npm run dev      # Watch mode — rebuilds on file changes
npm run build    # Production build with type checking
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

## Privacy

- Only sends text when the user explicitly asks.
- Skips password, payment, and OTP fields.
- No keystroke logging.
- No automatic page content reading.
- No API keys stored in the browser.

## Backend

This extension calls the existing Bhai Thik Kor API:

| Endpoint | Purpose |
|----------|---------|
| `/api/generate` | Prompt improvement (streaming) |
| `/api/clarify` | Guided Mode questions |
| `/api/refine` | Tweak/refine existing prompt |

Rate limits: 50 generates/day, 3 clarifies/minute, 5 refines/minute.
