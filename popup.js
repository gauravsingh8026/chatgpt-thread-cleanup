/**
 * Popup script: asks content script for messages, sends to background for analysis,
 * then displays summary, category, value, and recommendation.
 * Supports history (cached result + "Analyze again"), Copy result, and API key hint.
 */

(function () {
  'use strict';

  const analyzeBtn = document.getElementById('analyze');
  const loadingEl = document.getElementById('loading');
  const errorEl = document.getElementById('error');
  const errorHintEl = document.getElementById('error-hint');
  const resultEl = document.getElementById('result');
  const resultActionsEl = document.getElementById('result-actions');

  const HISTORY_KEY = 'analysisHistory';
  const HISTORY_MAX = 50;

  function getThreadIdFromUrl(url) {
    if (!url) return '';
    try {
      const path = new URL(url).pathname || '';
      return path || url;
    } catch (_) {
      return url;
    }
  }

  function showLoading(show) {
    loadingEl.classList.toggle('hidden', !show);
    errorEl.classList.add('hidden');
    errorHintEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    analyzeBtn.disabled = show;
  }

  function showError(msg, isApiKeyError) {
    loadingEl.classList.add('hidden');
    resultEl.classList.add('hidden');
    errorEl.classList.remove('hidden');
    errorEl.textContent = msg;
    if (isApiKeyError && errorHintEl) {
      errorHintEl.classList.remove('hidden');
      errorHintEl.textContent = 'Set your API key in Extension options (right‑click the extension icon → Options).';
    } else if (errorHintEl) {
      errorHintEl.classList.add('hidden');
    }
    analyzeBtn.disabled = false;
  }

  function showResult(analysis, fromCache) {
    loadingEl.classList.add('hidden');
    errorEl.classList.add('hidden');
    errorHintEl.classList.add('hidden');
    resultEl.classList.remove('hidden');
    analyzeBtn.disabled = false;
    if (fromCache) analyzeBtn.classList.add('hidden');
    else analyzeBtn.classList.remove('hidden');

    const rec = (analysis.recommendation || '').toLowerCase();
    const recClass = rec === 'keep' ? 'keep' : rec === 'archive' ? 'archive' : 'delete';

    const cacheLabel = fromCache ? '<p class="from-cache">From cache</p>' : '';
    resultEl.innerHTML =
      cacheLabel +
      '<h2>Summary</h2><p>' + escapeHtml(analysis.summary || '—') + '</p>' +
      '<p><strong>Category:</strong> ' + escapeHtml(analysis.category || '—') + '</p>' +
      '<p><strong>Value:</strong> ' + escapeHtml(String(analysis.value ?? '—')) + ' / 10</p>' +
      '<p><strong>Recommendation:</strong> <span class="rec ' + recClass + '">' +
      escapeHtml(analysis.recommendation || '—') + '</span></p>';

    if (resultActionsEl) {
      resultActionsEl.classList.remove('hidden');
      resultActionsEl.innerHTML = '';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'secondary';
      copyBtn.textContent = 'Copy result';
      copyBtn.addEventListener('click', () => copyResultToClipboard(analysis));
      resultActionsEl.appendChild(copyBtn);
      const archiveBtn = document.createElement('button');
      archiveBtn.type = 'button';
      archiveBtn.className = 'btn-archive';
      archiveBtn.textContent = 'Archive';
      archiveBtn.title = 'Click the Archive option in the conversation menu on the page';
      archiveBtn.addEventListener('click', () => triggerPageAction('TRIGGER_ARCHIVE', archiveBtn));
      resultActionsEl.appendChild(archiveBtn);
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.title = 'Click the Delete option in the conversation menu on the page';
      deleteBtn.addEventListener('click', () => triggerPageAction('TRIGGER_DELETE', deleteBtn));
      resultActionsEl.appendChild(deleteBtn);
      if (fromCache) {
        const againBtn = document.createElement('button');
        againBtn.type = 'button';
        againBtn.className = 'primary';
        againBtn.textContent = 'Analyze again';
        againBtn.addEventListener('click', runAnalysis);
        resultActionsEl.appendChild(againBtn);
      }
    }
    sendBadgeToPage(analysis);
  }

  function sendBadgeToPage(analysis) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || (!tab.url?.startsWith('https://chat.openai.com/') && !tab.url?.startsWith('https://chatgpt.com/'))) return;
      chrome.tabs.sendMessage(tab.id, { type: 'SHOW_BADGE', analysis }, () => { if (chrome.runtime.lastError) { /* ignore */ } });
    });
  }

  function triggerPageAction(type, buttonEl) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || (!tab.url?.startsWith('https://chat.openai.com/') && !tab.url?.startsWith('https://chatgpt.com/'))) {
        if (buttonEl) buttonEl.textContent = 'Open a ChatGPT tab first';
        return;
      }
      const origText = buttonEl?.textContent || '';
      if (buttonEl) buttonEl.disabled = true;
      chrome.tabs.sendMessage(tab.id, { type }, (response) => {
        if (buttonEl) {
          buttonEl.disabled = false;
          buttonEl.textContent = (response?.ok) ? 'Done' : 'Not found';
          setTimeout(() => { buttonEl.textContent = origText; }, 2000);
        }
      });
    });
  }

  function copyResultToClipboard(analysis) {
    const text =
      'Summary: ' + (analysis.summary || '—') + '\n' +
      'Category: ' + (analysis.category || '—') + '\n' +
      'Value: ' + (analysis.value ?? '—') + ' / 10\n' +
      'Recommendation: ' + (analysis.recommendation || '—');
    navigator.clipboard.writeText(text).then(() => {
      const btn = resultActionsEl?.querySelector('.secondary');
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy result'; }, 1500); }
    }).catch(() => {});
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  /** Save analysis to history (keyed by threadId). Cap at HISTORY_MAX entries. */
  function saveToHistory(threadId, analysis) {
    chrome.storage.local.get([HISTORY_KEY], (result) => {
      const history = result[HISTORY_KEY] || {};
      history[threadId] = { analysis, timestamp: Date.now() };
      const entries = Object.entries(history).sort((a, b) => b[1].timestamp - a[1].timestamp);
      const trimmed = Object.fromEntries(entries.slice(0, HISTORY_MAX));
      chrome.storage.local.set({ [HISTORY_KEY]: trimmed });
    });
  }

  /**
   * Get the active tab and request messages from the content script. Resolves with { messages, tab }.
   */
  function getMessagesFromTab() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab?.id) {
          reject(new Error('No active tab.'));
          return;
        }
        const isChatGPT = tab.url && (tab.url.startsWith('https://chat.openai.com/') || tab.url.startsWith('https://chatgpt.com/'));
        if (!isChatGPT) {
          reject(new Error('Open a ChatGPT conversation first (chat.openai.com or chatgpt.com).'));
          return;
        }
        chrome.tabs.sendMessage(tab.id, { type: 'GET_THREAD_MESSAGES' }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error('Could not read the page. Refresh the conversation and try again.'));
            return;
          }
          if (response?.ok && Array.isArray(response.messages)) {
            resolve({ messages: response.messages, tab });
          } else {
            reject(new Error(response?.error || 'No messages extracted.'));
          }
        });
      });
    });
  }

  function analyzeWithBackground(messages) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'ANALYZE_THREAD', messages }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Background error.'));
          return;
        }
        if (response?.ok && response.analysis) {
          resolve(response.analysis);
        } else {
          reject(new Error(response?.error || 'Analysis failed.'));
        }
      });
    });
  }

  async function runAnalysis() {
    showLoading(true);
    try {
      const { messages, tab } = await getMessagesFromTab();
      if (messages.length === 0) {
        showError('No messages found on this page. Scroll the conversation into view and try again.');
        return;
      }
      const analysis = await analyzeWithBackground(messages);
      const threadId = getThreadIdFromUrl(tab.url);
      if (threadId) saveToHistory(threadId, analysis);
      showResult(analysis, false);
    } catch (e) {
      const msg = e.message || 'Something went wrong.';
      const isApiKeyError = /API key|Invalid API key|No API key/i.test(msg);
      showError(msg, isApiKeyError);
    }
  }

  /** On load: show cached result if we have one for this thread, or pending shortcut result. */
  function init() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab?.id || (!tab.url?.startsWith('https://chat.openai.com/') && !tab.url?.startsWith('https://chatgpt.com/'))) {
        return;
      }
      const threadId = getThreadIdFromUrl(tab.url);
      chrome.storage.local.get([HISTORY_KEY, 'pendingShortcutResult', 'pendingShortcutThreadId'], (result) => {
        const pending = result.pendingShortcutResult;
        const pendingId = result.pendingShortcutThreadId;
        if (pending && pendingId === threadId) {
          chrome.storage.local.remove(['pendingShortcutResult', 'pendingShortcutThreadId']);
          showResult(pending, false);
          return;
        }
        const history = result[HISTORY_KEY] || {};
        const cached = history[threadId];
        if (cached?.analysis) {
          showResult(cached.analysis, true);
          return;
        }
        // Default: show Analyze button (already visible)
      });
    });
  }

  analyzeBtn.addEventListener('click', runAnalysis);
  init();
})();
