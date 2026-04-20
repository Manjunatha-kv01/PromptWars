/**
 * content.js — MyEvent.io Content Script
 * Injected into every page. Sends page info back to background for scraping.
 * Also assists with URL anomaly detection on page load.
 */

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__myeventio_injected) return;
  window.__myeventio_injected = true;

  /**
   * Notify background script about current URL for typo check.
   * (Background also handles this via webNavigation, but content script
   * can catch edge cases like hash navigation.)
   */
  function reportCurrentUrl() {
    const url = window.location.href;
    chrome.runtime.sendMessage({
      type: 'PAGE_VISIT',
      url,
      title: document.title,
    }).catch(() => {}); // Ignore if service worker is sleeping
  }

  reportCurrentUrl();

  // Watch for SPA navigation (pushState / replaceState)
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    setTimeout(reportCurrentUrl, 500);
  };

  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    setTimeout(reportCurrentUrl, 500);
  };

  window.addEventListener('popstate', () => {
    setTimeout(reportCurrentUrl, 500);
  });

  // Listen for messages from popup (e.g. "get page content for scraping")
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_HTML') {
      sendResponse({ html: document.documentElement.outerHTML });
      return true;
    }

    if (msg.type === 'GET_PAGE_META') {
      sendResponse({
        url: window.location.href,
        title: document.title,
        description:
          document.querySelector('meta[name="description"]')?.content || '',
      });
      return true;
    }
  });
})();
