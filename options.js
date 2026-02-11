/**
 * Options page: API key, model, and analysis personalization (profile, interests, categories, custom prompt).
 */

(function () {
  'use strict';

  const form = document.getElementById('options-form');
  const input = document.getElementById('api-key');
  const modelSelect = document.getElementById('model');
  const userProfileEl = document.getElementById('user-profile');
  const interestsEl = document.getElementById('interests');
  const categoriesEl = document.getElementById('categories');
  const customPromptEl = document.getElementById('custom-prompt');
  const resetPromptBtn = document.getElementById('reset-prompt');
  const clearBtn = document.getElementById('clear');
  const statusEl = document.getElementById('status');

  const STORAGE_KEYS = [
    'openaiApiKey',
    'openaiModel',
    'analysisUserProfile',
    'analysisInterests',
    'analysisCategories',
    'analysisCustomPrompt'
  ];

  function showStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + (isError ? 'error' : 'success');
    statusEl.classList.remove('hidden');
  }

  function hideStatus() {
    statusEl.classList.add('hidden');
  }

  /** Load all saved options from storage. */
  function loadSaved() {
    chrome.storage.local.get(STORAGE_KEYS, function (result) {
      input.value = result.openaiApiKey || '';
      if (modelSelect) modelSelect.value = result.openaiModel || 'gpt-4o-mini';
      if (userProfileEl) userProfileEl.value = result.analysisUserProfile || '';
      if (interestsEl) interestsEl.value = result.analysisInterests || '';
      if (categoriesEl) categoriesEl.value = result.analysisCategories || '';
      if (customPromptEl) customPromptEl.value = result.analysisCustomPrompt || '';
    });
  }

  /** Save all options to chrome.storage.local. */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    hideStatus();
    const data = {
      openaiApiKey: (input.value || '').trim(),
      openaiModel: modelSelect ? modelSelect.value : 'gpt-4o-mini',
      analysisUserProfile: userProfileEl ? (userProfileEl.value || '').trim() : '',
      analysisInterests: interestsEl ? (interestsEl.value || '').trim() : '',
      analysisCategories: categoriesEl ? (categoriesEl.value || '').trim() : '',
      analysisCustomPrompt: customPromptEl ? (customPromptEl.value || '').trim() : ''
    };
    chrome.storage.local.set(data, function () {
      if (chrome.runtime.lastError) {
        showStatus('Failed to save: ' + chrome.runtime.lastError.message, true);
        return;
      }
      showStatus('Options saved.', false);
    });
  });

  /** Reset custom prompt textarea to the extension default (fetched from background). */
  if (resetPromptBtn && customPromptEl) {
    resetPromptBtn.addEventListener('click', function () {
      chrome.runtime.sendMessage({ type: 'GET_DEFAULT_PROMPT' }, function (response) {
        if (response?.ok && response.prompt) {
          customPromptEl.value = response.prompt.trim();
          showStatus('Default prompt loaded. Click Save to use it.', false);
        } else {
          showStatus('Could not load default prompt.', true);
        }
      });
    });
  }

  /** Clear API key only. */
  clearBtn.addEventListener('click', function () {
    hideStatus();
    input.value = '';
    chrome.storage.local.remove(['openaiApiKey'], function () {
      showStatus('API key cleared.', false);
    });
  });

  loadSaved();
})();
