# ChatGPT Thread Cleanup

Chrome Extension (Manifest v3) that analyzes the currently open ChatGPT conversation and shows a **summary**, **category**, **value score (1–10)**, and **recommendation** (Keep / Archive / Delete).

## Setup

1. **Load the extension in Chrome**
   - Open `chrome://extensions/`
   - Turn on **Developer mode**
   - Click **Load unpacked** and select this folder (`chatgpt-thread-cleanup`)

2. **Add your OpenAI API key (and optional model)**
   - **Recommended:** Right-click the extension icon → **Options**. Enter your API key, choose a model (e.g. gpt-4o-mini), and click **Save**. Stored locally on this device.
   - **Alternatively:** Set `OPENAI_API_KEY` in `background.js`; the options page is used only when that is empty.

## How to use

1. Open a conversation on [chat.openai.com](https://chat.openai.com) or [chatgpt.com](https://chatgpt.com).
2. Click the extension icon (or press **Ctrl+Shift+A** / **Cmd+Shift+A** on Mac to analyze and open the popup).
3. If this thread was analyzed before, the **cached result** is shown with **Copy result** and **Analyze again**. Otherwise click **Analyze this thread**.
4. The popup shows: Summary, Category, Value (1–10), and Recommendation (Keep / Archive / Delete). Use **Copy result** to paste into notes or a spreadsheet.
5. A **badge** is injected on the ChatGPT page (top-right): score and action (e.g. `7/10 · Keep`) in green / amber / red. Click the badge to dismiss it.
6. Use **Archive** or **Delete** in the popup to trigger the same action on the current conversation (opens the conversation menu and clicks Archive or Delete). If the button isn’t found, the popup shows “Not found”.

## Files

| File | Purpose |
|------|--------|
| `manifest.json` | Extension config (Manifest v3), permissions, content script and popup |
| `content.js` | Runs on chat.openai.com and chatgpt.com; extracts visible messages (role + text) from the page |
| `background.js` | Service worker; receives messages, calls OpenAI API, returns analysis |
| `popup.html` / `popup.js` | Popup UI; triggers extraction → analysis → display |
| `options.html` / `options.js` | Options page; API key and model (gpt-4o-mini / gpt-4o) in local storage |

## Notes

- **API key**: Stored only in your extension (background or options). Do not publish the extension with a key if sharing.
- **History**: The last 50 analyses are cached by thread (URL). Re-opening the popup on the same conversation shows the cached result; use **Analyze again** to re-run.
- **Shortcut**: Set or change the keyboard shortcut at `chrome://extensions` → your extension → **Details** → **Keyboard shortcuts**.
- **DOM changes**: If ChatGPT’s page structure changes, message extraction or the Archive/Delete trigger may fail; update the selectors in `content.js` (e.g. `[aria-label="Chat history"]`, `[role="menu"]`, `[role="menuitem"]`).
