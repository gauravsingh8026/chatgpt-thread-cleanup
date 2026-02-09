/**
 * Options page: save and load the OpenAI API key in chrome.storage.local.
 * The background script reads this key when OPENAI_API_KEY in background.js is empty.
 */

(function () {
  'use strict';

  const form = document.getElementById('options-form');
  const input = document.getElementById('api-key');
  const modelSelect = document.getElementById('model');
  const clearBtn = document.getElementById('clear');
  const statusEl = document.getElementById('status');

  const STORAGE_KEY = 'openaiApiKey';
  const MODEL_KEY = 'openaiModel';

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + (isError ? 'error' : 'success');
    statusEl.classList.remove('hidden');
  }

  function hideStatus() {
    statusEl.classList.add('hidden');
  }

  /** Load saved key and model from storage. */
  function loadSaved() {
    chrome.storage.local.get([STORAGE_KEY, MODEL_KEY], function (result) {
      input.value = result[STORAGE_KEY] || '';
      if (modelSelect) modelSelect.value = result[MODEL_KEY] || 'gpt-4o-mini';
    });
  }

  /** Save key and model to chrome.storage.local. */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideStatus();
    const key = (input.value || '').trim();
    const model = modelSelect ? modelSelect.value : 'gpt-4o-mini';
    chrome.storage.local.set({ [STORAGE_KEY]: key, [MODEL_KEY]: model }, function () {
      if (chrome.runtime.lastError) {
        showStatus('Failed to save: ' + chrome.runtime.lastError.message, true);
        return;
      }
      showStatus('Options saved.', false);
    });
  });

  /** Clear key from storage and input. */
  clearBtn.addEventListener('click', function () {
    hideStatus();
    input.value = '';
    chrome.storage.local.remove([STORAGE_KEY], function () {
      showStatus('API key cleared.', false);
    });
  });

  loadSaved();
})();
