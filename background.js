/**
 * Background service worker (Manifest v3).
 * Receives extracted conversation from content script, calls OpenAI API,
 * returns analysis (summary, category, value, recommendation).
 */

// ——— API KEY: paste your key here, or leave empty to use the one from storage (options page) ———
const OPENAI_API_KEY = '';

const ANALYSIS_SYSTEM_PROMPT = `
You evaluate personal ChatGPT conversation threads for long-term usefulness.

User profile:
- Software developer
- Interested in product building, writing, startups, and career growth

Your task:
Analyze the conversation and return EXACTLY this JSON (no markdown, no extra text):

{
  "summary": "1–2 precise sentences describing what was discussed and why",
  "category": "career | writing | project | tech | humor | other",
  "value": number,
  "confidence": number,
  "recommendation": "Keep | Archive | Delete",
  "reason": "one short sentence explaining the recommendation"
}

Scoring rules for "value" (1–10):

9–10: Long-term strategic value, reusable insights, affects career or projects
7–8: Strong practical value, likely to be reused
5–6: Useful but limited or context-specific
3–4: Minor, repetitive, or easily replaceable
1–2: Trivial, generic, or no lasting value

Important evaluation rule:
If the conversation mainly contains generic explanations, definitions, or how-to information that can be easily re-found via search engines or official documentation, cap value at 4 and recommend Archive or Delete.

High value threads must include at least one of:
- personal reasoning or opinion
- decision-making context
- trade-offs or constraints
- original ideas or reflections
- project-specific implementation thinking

"confidence" (1–5):
How confident you are in this evaluation.

Recommendation rules:
- Keep: value >= 7
- Archive: value 4–6
- Delete: value <= 3

Constraints:
- Be critical, not polite
- Prefer lower scores when unsure
- Do not inflate scores
- Output valid JSON only
`;


function getAnalysisUserPrompt(messages) {
  const blob = messages
    .map((m) => `[${m.role}]\n${m.text}`)
    .join('\n\n---\n\n');
  return `Analyze this conversation and respond with the JSON only:\n\n${blob}`;
}

/**
 * Call OpenAI Chat Completions API. Returns parsed analysis or throws.
 */
async function callOpenAI(messages) {
  const key = OPENAI_API_KEY || (await getStoredApiKey());
  if (!key || !key.trim()) {
    throw new Error('No API key. Add OPENAI_API_KEY in background.js or set it in extension options.');
  }

  const model = await getStoredModel();
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key.trim()}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: getAnalysisUserPrompt(messages) },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) throw new Error('Invalid API key.');
    throw new Error(`API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Empty response from OpenAI.');

  // Strip optional markdown code fence
  const raw = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  return JSON.parse(raw);
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['openaiApiKey'], (result) => {
      resolve(result?.openaiApiKey || '');
    });
  });
}

function getStoredModel() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['openaiModel'], (result) => {
      resolve(result?.openaiModel || 'gpt-4o-mini');
    });
  });
}

/**
 * Handle messages from popup: analyze thread (messages come from content script via popup).
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'ANALYZE_THREAD' && Array.isArray(request.messages)) {
    callOpenAI(request.messages)
      .then((analysis) => sendResponse({ ok: true, analysis }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async sendResponse
  }
  sendResponse({ ok: false, error: 'Invalid request' });
  return false;
});

/**
 * Keyboard shortcut: get messages from active tab, analyze, store result for popup, open popup.
 */
chrome.commands?.onCommand?.addListener((command) => {
  if (command !== 'analyze') return;
  (async () => {
    const [tab] = await new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => r(tabs || [])));
    if (!tab?.id || (!tab.url?.startsWith('https://chat.openai.com/') && !tab.url?.startsWith('https://chatgpt.com/'))) return;
    const threadId = getThreadIdFromUrl(tab.url);
    const messages = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_THREAD_MESSAGES' }, (response) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response?.ok && Array.isArray(response.messages) && response.messages.length > 0) resolve(response.messages);
        else reject(new Error('No messages'));
      });
    });
    const analysis = await callOpenAI(messages);
    await saveToHistory(threadId, analysis);
    await new Promise((r) => chrome.storage.local.set({ pendingShortcutResult: analysis, pendingShortcutThreadId: threadId }, r));
    try { await chrome.action.openPopup(); } catch (_) { /* openPopup can fail in some contexts */ }
  })().catch(() => {});
});

function getThreadIdFromUrl(url) {
  try {
    const path = new URL(url).pathname || '';
    return path || url;
  } catch (_) {
    return url || 'unknown';
  }
}

const HISTORY_KEY = 'analysisHistory';
const HISTORY_MAX = 50;

function saveToHistory(threadId, analysis) {
  return new Promise((resolve) => {
    chrome.storage.local.get([HISTORY_KEY], (result) => {
      const history = result[HISTORY_KEY] || {};
      history[threadId] = { analysis, timestamp: Date.now() };
      const entries = Object.entries(history).sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed = Object.fromEntries(entries.slice(0, HISTORY_MAX));
      chrome.storage.local.set({ [HISTORY_KEY]: trimmed }, resolve);
    });
  });
}
