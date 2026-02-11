# ChatGPT Thread Cleanup

Chrome Extension (Manifest v3) that analyzes the currently open ChatGPT conversation and shows a **summary**, **category**, **value score (1–10)**, and **recommendation** (Keep / Archive / Delete).

## Setup

1. **Load the extension in Chrome**
   - Open `chrome://extensions/`
   - Turn on **Developer mode**
   - Click **Load unpacked** and select this folder (`chatgpt-thread-cleanup`)

2. **Add your OpenAI API key and optional personalization**
   - **Recommended:** Right-click the extension icon → **Options** (opens in a new tab). Enter your API key, choose a model (e.g. gpt-4o-mini), and optionally set **User profile**, **Interested in**, and **Categories** so the analysis uses your context. You can also set a **Custom system prompt** (the built-in prompt is the default; use "Reset to default prompt" to load it). Click **Save**. All stored locally.
   - **Alternatively:** Set `OPENAI_API_KEY` in `background.js`; the options page is used only when that is empty.

## How to use

1. Open a conversation on [chat.openai.com](https://chat.openai.com) or [chatgpt.com](https://chatgpt.com).
2. Click the extension icon (or press **Ctrl+Shift+A** / **Cmd+Shift+A** on Mac to analyze and open the popup).
3. If this thread was analyzed before, the **cached result** is shown with **Copy result** and **Analyze again**. Otherwise click **Analyze this thread**.
4. The popup shows: Summary, Category, Value (1–10), and Recommendation (Keep / Archive / Delete). Use **Copy result** to paste into notes or a spreadsheet.
5. A **badge** is injected on the ChatGPT page (bottom-right): score and recommendation (e.g. `7/10 · Keep`) in green / amber / red. Click the badge to dismiss. The badge is removed automatically when you switch to a different thread.

## Files

| File | Purpose |
|------|--------|
| `manifest.json` | Extension config (Manifest v3), permissions, content script and popup |
| `content.js` | Runs on chat.openai.com and chatgpt.com; extracts visible messages (role + text) from the page |
| `background.js` | Service worker; receives messages, calls OpenAI API, returns analysis |
| `popup.html` / `popup.js` | Popup UI; triggers extraction → analysis → display |
| `options.html` / `options.js` | Options page; API key, model, personalization (profile, interests, categories), and optional custom system prompt |

## Notes

- **API key**: Stored only in your extension (background or options). Do not publish the extension with a key if sharing.
- **History**: The last 50 analyses are cached by thread (URL). Re-opening the popup on the same conversation shows the cached result; use **Analyze again** to re-run.
- **Shortcut**: Set or change the keyboard shortcut at `chrome://extensions` → your extension → **Details** → **Keyboard shortcuts**.
- **DOM changes**: If ChatGPT’s page structure changes, message extraction may fail; update the selectors in `content.js`.
