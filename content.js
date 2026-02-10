/**
 * Content script: runs on chat.openai.com and extracts the visible conversation.
 * Sends messages (role + text) to the background script for analysis.
 */

(function () {
  'use strict';

  /**
   * Get visible text from an element, skipping duplicate content from code blocks etc.
   */
  function getTextContent(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    const scripts = clone.querySelectorAll('script, style');
    scripts.forEach(s => s.remove());
    return (clone.textContent || '').trim().replace(/\s+/g, ' ');
  }

  /**
   * Try multiple known selectors for ChatGPT message containers.
   * OpenAI may change the DOM; update these if the UI changes.
   */
  function findMessageElements() {
    const PREFIX = '[ChatGPT Thread Cleanup]';

    // Strategy 1: data attribute for role (common in ChatGPT)
    const byDataRole = document.querySelectorAll('[data-message-author-role]');
    if (byDataRole.length > 0) {
      console.log(PREFIX, 'Strategy 1 (data-message-author-role): found', byDataRole.length, 'elements');
      return Array.from(byDataRole).map(el => {
        const role = (el.getAttribute('data-message-author-role') || 'unknown').toLowerCase();
        const content = el.querySelector('[data-message-content]') || el;
        return { el, role, content };
      });
    }

    // Strategy 2: articles (each turn is often an article)
    const articles = document.querySelectorAll('article');
    if (articles.length > 0) {
      console.log(PREFIX, 'Strategy 2 (article): found', articles.length, 'elements');
      return Array.from(articles).map(article => {
        let role = 'unknown';
        if (article.querySelector('[data-message-author-role="user"]')) role = 'user';
        else if (article.querySelector('[data-message-author-role="assistant"]')) role = 'assistant';
        else if (article.querySelector('[data-message-author-role="system"]')) role = 'system';
        else {
          const roleEl = article.querySelector('[data-message-author-role]');
          if (roleEl) role = (roleEl.getAttribute('data-message-author-role') || 'unknown').toLowerCase();
        }
        const content = article.querySelector('[data-message-content]') || article;
        return { el: article, role, content };
      });
    }

    // Strategy 3: group/turn divs with role in class or child
    const groups = document.querySelectorAll('[class*="group"]');
    const result = [];
    groups.forEach(g => {
      const roleEl = g.querySelector('[data-message-author-role]');
      const role = roleEl ? (roleEl.getAttribute('data-message-author-role') || 'unknown').toLowerCase() : 'unknown';
      const content = g.querySelector('[data-message-content]') || g;
      result.push({ el: g, role, content });
    });
    if (result.length > 0) {
      console.log(PREFIX, 'Strategy 3 (class*="group"): found', result.length, 'elements');
      return result;
    }

    console.log(PREFIX, 'No strategy matched; no message elements found');
    return [];
  }

  /**
   * Extract all visible messages as { role, text }.
   */
  function extractMessages() {
    const items = findMessageElements();
    const messages = [];
    const seen = new Set();

    for (const { role, content } of items) {
      const text = getTextContent(content);
      if (!text) continue;
      // Dedupe by first 100 chars (avoid duplicate blocks)
      const key = text.slice(0, 100);
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ role, text });
    }

    if (messages.length > 0) {
      console.log('[ChatGPT Thread Cleanup] Extracted', messages.length, 'messages');
    }
    return messages;
  }

  const BADGE_ID = 'chatgpt-thread-cleanup-badge';
  let badgeThreadId = '';
  let badgeCheckInterval = null;

  function removeBadge() {
    const el = document.getElementById(BADGE_ID);
    if (el) el.remove();
    if (badgeCheckInterval) {
      clearInterval(badgeCheckInterval);
      badgeCheckInterval = null;
    }
    badgeThreadId = '';
  }

  /**
   * Inject or update a badge on the page showing score and recommendation (Keep/Archive/Delete).
   * Position: bottom-right. Removed when thread (pathname) changes.
   */
  function showBadge(analysis, threadId) {
    const path = (window.location.pathname || '').replace(/\/$/, '');
    if (threadId && threadId !== path) {
      removeBadge();
      return;
    }
    badgeThreadId = path;

    let el = document.getElementById(BADGE_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BADGE_ID;
      el.style.cssText = [
        'position:fixed;bottom:24px;right:24px;z-index:2147483647;',
        'font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;',
        'padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.2);',
        'display:flex;align-items:center;cursor:pointer;user-select:none;',
        'transition:opacity 0.2s;'
      ].join('');
      el.title = 'Thread Cleanup – click to dismiss';
      el.addEventListener('click', removeBadge);
      document.body.appendChild(el);
    }
    const rec = (analysis.recommendation || 'Keep').toLowerCase();
    const value = analysis.value != null ? Number(analysis.value) : 0;
    const colors = {
      keep: { bg: '#0d6b0d', fg: '#fff' },
      archive: { bg: '#b8860b', fg: '#fff' },
      delete: { bg: '#b91c1c', fg: '#fff' }
    };
    const c = colors[rec] || colors.keep;
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.textContent = `${value}/10 · ${(analysis.recommendation || 'Keep')}`;

    if (badgeCheckInterval) clearInterval(badgeCheckInterval);
    badgeCheckInterval = setInterval(() => {
      const currentPath = (window.location.pathname || '').replace(/\/$/, '');
      if (currentPath !== badgeThreadId) removeBadge();
    }, 1000);
  }

  /**
   * Listen for requests from popup/background.
   */
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.type === 'GET_THREAD_MESSAGES') {
      const messages = extractMessages();
      sendResponse({ ok: true, messages });
      return true;
    }
    if (request.type === 'SHOW_BADGE' && request.analysis) {
      showBadge(request.analysis, request.threadId);
      sendResponse({ ok: true });
      return true;
    }
    sendResponse({ ok: false, error: 'Unknown request type' });
    return false;
  });
})();
