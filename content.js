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
    // Strategy 1: data attribute for role (common in ChatGPT)
    const byDataRole = document.querySelectorAll('[data-message-author-role]');
    if (byDataRole.length > 0) {
      return Array.from(byDataRole).map(el => {
        const role = (el.getAttribute('data-message-author-role') || 'unknown').toLowerCase();
        const content = el.querySelector('[data-message-content]') || el;
        return { el, role, content };
      });
    }

    // Strategy 2: articles (each turn is often an article)
    const articles = document.querySelectorAll('article');
    if (articles.length > 0) {
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
    if (result.length > 0) return result;

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

    return messages;
  }

  const BADGE_ID = 'chatgpt-thread-cleanup-badge';

  /**
   * Inject or update a badge on the page showing score and recommendation (Keep/Archive/Delete).
   * Colors: Keep = green, Archive = amber, Delete = red.
   */
  function showBadge(analysis) {
    let el = document.getElementById(BADGE_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BADGE_ID;
      el.style.cssText = [
        'position:fixed;top:16px;right:16px;z-index:2147483647;',
        'font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;',
        'padding:8px 12px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.15);',
        'display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;',
        'transition:opacity 0.2s;'
      ].join('');
      el.title = 'Thread Cleanup badge – click to dismiss';
      el.addEventListener('click', () => el.remove());
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
  }

  /**
   * Try to open the sidebar if it might be collapsed (so the conversation list is visible).
   */
  function ensureSidebarOpen() {
    const toggleSelectors = [
      'button[aria-label="Open sidebar"]',
      'button[aria-label="Close sidebar"]',
      'button[aria-expanded]',
      '[data-testid="sidebar-toggle"]'
    ];
    for (const sel of toggleSelectors) {
      const btn = document.querySelector(sel);
      if (!btn) continue;
      const expanded = btn.getAttribute('aria-expanded');
      if (expanded === 'false' || expanded === null) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  /**
   * Find the sidebar chat row that matches the current conversation, then its menu (three-dots) button.
   * Tries multiple strategies: exact path, path in href, then first chat in sidebar.
   */
  function findCurrentChatMenuButton() {
    const path = window.location.pathname || '';

    const roots = [
      document.querySelector('[aria-label="Chat history"]'),
      document.querySelector('[aria-label="Conversations"]'),
      document.querySelector('[data-testid="chat-history"]'),
      document.querySelector('nav'),
      document.querySelector('aside'),
      document.querySelector('[class*="sidebar"]'),
      document.body
    ].filter(Boolean);

    const norm = (p) => (p || '').replace(/\/$/, '').split('?')[0];
    for (const root of roots) {
      const links = root.querySelectorAll('a[href^="/c/"], a[href^="/g/"]');
      for (const link of links) {
        const href = norm(link.getAttribute('href') || '');
        if (norm(path) !== href) continue;
        const container = link.closest('li') || link.closest('[role="listitem"]') || link.closest('[class*="group"]') || link.closest('div') || link.parentElement;
        if (!container) continue;
        const buttons = container.querySelectorAll('button');
        for (const btn of buttons) {
          if (btn.offsetParent !== null) return btn;
        }
        if (link.nextElementSibling && link.nextElementSibling.tagName === 'BUTTON') return link.nextElementSibling;
        if (link.previousElementSibling && link.previousElementSibling.tagName === 'BUTTON') return link.previousElementSibling;
        const parent = link.parentElement;
        if (parent) {
          const siblingBtn = parent.querySelector('button');
          if (siblingBtn) return siblingBtn;
        }
      }
    }

    const activeLink = document.querySelector('a[aria-current="page"][href^="/c/"], a[aria-current="page"][href^="/g/"], a[href^="/c/"].active, a[href^="/g/"].active');
    if (activeLink) {
      const container = activeLink.closest('li') || activeLink.closest('[role="listitem"]') || activeLink.parentElement;
      const btn = container?.querySelector('button');
      if (btn) return btn;
    }

    return null;
  }

  /**
   * Open the conversation menu and click the menu item whose text matches (e.g. "Archive" or "Delete").
   * Returns a Promise that resolves to true if the item was found and clicked.
   */
  function openMenuAndClickItem(labelMatch) {
    return new Promise((resolve) => {
      ensureSidebarOpen();
      const menuBtn = findCurrentChatMenuButton();
      if (!menuBtn) {
        setTimeout(() => {
          const retryBtn = findCurrentChatMenuButton();
          if (retryBtn) {
            retryBtn.click();
            waitForMenuAndClick(labelMatch, resolve);
          } else resolve(false);
        }, 500);
        return;
      }
      menuBtn.click();
      waitForMenuAndClick(labelMatch, resolve);
    });
  }

  function waitForMenuAndClick(labelMatch, resolve) {
    const tryFindAndClick = (attempt) => {
      const menu = document.querySelector('[role="menu"]');
      const items = menu ? [...menu.querySelectorAll('[role="menuitem"]')] : [];
      const byRole = items.find((i) => (i.textContent || '').toLowerCase().includes(labelMatch.toLowerCase()));
      if (byRole) {
        byRole.click();
        resolve(true);
        return;
      }
      const allClickables = document.querySelectorAll('[role="menuitem"], [role="option"], button, [role="button"]');
      for (const el of allClickables) {
        const text = (el.textContent || '').toLowerCase();
        if (text.includes(labelMatch.toLowerCase()) && el.offsetParent !== null) {
          el.click();
          resolve(true);
          return;
        }
      }
      if (attempt < 4) setTimeout(() => tryFindAndClick(attempt + 1), 250);
      else resolve(false);
    };
    setTimeout(() => tryFindAndClick(0), 350);
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
      showBadge(request.analysis);
      sendResponse({ ok: true });
      return true;
    }
    if (request.type === 'TRIGGER_ARCHIVE') {
      openMenuAndClickItem('archive').then((ok) => sendResponse({ ok }));
      return true;
    }
    if (request.type === 'TRIGGER_DELETE') {
      openMenuAndClickItem('delete').then((ok) => sendResponse({ ok }));
      return true;
    }
    sendResponse({ ok: false, error: 'Unknown request type' });
    return false;
  });
})();
