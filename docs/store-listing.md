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

## Privacy policy URL

https://bhaithikkor.vercel.app/privacy — served by the web app repo (`../prompt-generator`,
`app/privacy/page.tsx`). It must be deployed and reachable before submitting; the store rejects
an unreachable policy URL.
