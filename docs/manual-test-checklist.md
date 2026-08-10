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
