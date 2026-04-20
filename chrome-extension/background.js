/**
 * background.js — MyEvent.io Service Worker
 *
 * Responsibilities:
 *  1. Detect malformed/typo URLs (double-dot pattern)
 *  2. Run daily bookmark scanner via chrome.alarms
 *  3. Sync data to backend when online
 */

import {
  openDB,
  addAnomaly,
  getUnsyncedAnomalies,
  markAnomalySynced,
  addEvent,
  isDuplicateEvent,
  markEventNotified,
  getUnsyncedEvents,
  markEventSynced,
} from './db.js';

import { extractEvents, fetchPageHTML } from './scraper.js';

import {
  loadCriteria,
  matchesCriteria,
  notifyMatchedEvent,
  notifyUrlTypo,
  notifyScanComplete,
} from './notifier.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const TYPO_REGEX = /https?:\/\/[^/]*\.\.[^/]*/;
const API_BASE = 'https://api.myevent.io'; // Change to localhost:3001 for dev
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — URL ANOMALY / TYPO DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a URL contains a double-dot typo pattern.
 */
function isMalformedUrl(url) {
  return TYPO_REGEX.test(url);
}

/**
 * Suggest a corrected URL by replacing ".." with "."
 */
function correctUrl(url) {
  return url.replace(/([^:])\/\//, '$1/').replace(/\.\.+/g, '.');
}

/**
 * Extract site name from URL.
 */
function getSiteName(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Handle a potentially malformed URL.
 * @param {string} url - The URL to inspect
 * @param {number} tabId - Chrome tab ID
 */
async function handlePotentialTypo(url, tabId) {
  if (!url || !isMalformedUrl(url)) return;

  const correctedUrl = correctUrl(url);
  const siteName = getSiteName(url);

  // Get user ID from storage
  const { authUser } = await chrome.storage.local.get(['authUser']);
  const userId = authUser?.user_id || 'anonymous';

  const anomaly = {
    original_url: url,
    corrected_url: correctedUrl,
    timestamp: Date.now(),
    user_id: userId,
    site_name: siteName,
    status: 'detected',
  };

  try {
    await addAnomaly(anomaly);
    console.log('[MyEvent.io] URL anomaly stored:', url);
  } catch (err) {
    console.error('[MyEvent.io] Failed to store anomaly:', err);
  }

  // Send notification
  await notifyUrlTypo(url, correctedUrl);

  // Auto-redirect if the user has opted in
  const { settings } = await chrome.storage.local.get(['settings']);
  const autoRedirect = settings?.autoRedirect ?? true;

  if (autoRedirect && tabId) {
    setTimeout(() => {
      chrome.tabs.update(tabId, { url: correctedUrl }).catch(() => {});
    }, 2000);
  }

  // Attempt background sync
  syncAnomalies().catch(() => {});
}

// Listen on webNavigation.onBeforeNavigate
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const { url, tabId, frameId } = details;
  if (frameId !== 0) return; // Only top-level frames
  handlePotentialTypo(url, tabId);
});

// Also listen on tabs.onUpdated as a fallback
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading') return;
  const url = changeInfo.url || tab.url;
  if (!url) return;
  handlePotentialTypo(url, tabId);
});

// Handle notification button clicks
chrome.notifications.onButtonClicked.addListener(async (notifId, btnIdx) => {
  // URL typo notification
  if (notifId.startsWith('typo_')) {
    const { pendingTypoRedirects } = await chrome.storage.local.get([
      'pendingTypoRedirects',
    ]);
    const info = (pendingTypoRedirects || {})[notifId];
    if (info) {
      if (btnIdx === 0) {
        // "Go to Corrected URL"
        chrome.tabs.create({ url: info.correctedUrl });
      }
      // Clean up
      delete pendingTypoRedirects[notifId];
      chrome.storage.local.set({ pendingTypoRedirects });
    }
  }

  // Event match notification
  if (notifId.startsWith('event_')) {
    const { lastNotifiedEvent } = await chrome.storage.local.get([
      'lastNotifiedEvent',
    ]);
    if (btnIdx === 0 && lastNotifiedEvent?.source_url) {
      chrome.tabs.create({ url: lastNotifiedEvent.source_url });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — ALARM-DRIVEN DAILY SCANNER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate milliseconds until next 8:00 AM.
 */
function getNext8AM() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
}

/**
 * Register the daily scan alarm on install/startup.
 */
function registerDailyAlarm() {
  chrome.alarms.get('daily_scan', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('daily_scan', {
        when: getNext8AM(),
        periodInMinutes: 1440, // 24 hours
      });
      console.log('[MyEvent.io] Daily scan alarm registered for 8:00 AM');
    }
  });
}

// Also register a sync alarm every 30 minutes
function registerSyncAlarm() {
  chrome.alarms.get('sync_data', (alarm) => {
    if (!alarm) {
      chrome.alarms.create('sync_data', {
        delayInMinutes: 5,
        periodInMinutes: 30,
      });
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'daily_scan') {
    console.log('[MyEvent.io] Daily scan alarm triggered');
    await runDailyScan();
  } else if (alarm.name === 'sync_data') {
    await syncAll();
  }
});

/**
 * Process URLs in batches of BATCH_SIZE with a delay between batches.
 */
async function processInBatches(urls, processor) {
  const results = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);
    if (i + BATCH_SIZE < urls.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  return results;
}

/**
 * Scrape a single event source and store results.
 */
async function scrapeSource(sourceInfo, criteria, userId) {
  const { url, name } = sourceInfo;
  console.log(`[MyEvent.io] Scraping: ${url}`);

  const html = await fetchPageHTML(url);
  if (!html) {
    console.warn(`[MyEvent.io] Unreachable: ${url}`);
    return { url, eventsFound: 0, matched: 0, status: 'unreachable' };
  }

  const events = extractEvents(html, url, name || getSiteName(url), userId);
  let eventsFound = 0;
  let matched = 0;

  for (const event of events) {
    try {
      // Deduplication check
      const isDup = await isDuplicateEvent(event.title, event.date, event.source_url);
      if (isDup) continue;

      // Check criteria
      const isMatch = matchesCriteria(event, criteria);
      event.matched_criteria = isMatch;

      const eventId = await addEvent(event);

      if (isMatch) {
        matched++;
        await notifyMatchedEvent(event);
        await markEventNotified(eventId);
        // Store for notification click handling
        chrome.storage.local.set({ lastNotifiedEvent: event });
      }

      eventsFound++;
    } catch (err) {
      console.error('[MyEvent.io] Error storing event:', err);
    }
  }

  return { url, eventsFound, matched, status: 'ok' };
}

/**
 * Main daily scan routine.
 */
async function runDailyScan() {
  // Ensure DB is open
  await openDB();

  const { authUser, event_sources, settings } = await chrome.storage.local.get([
    'authUser',
    'event_sources',
    'settings',
  ]);

  const userId = authUser?.user_id || 'anonymous';
  const sources = event_sources || [];

  if (sources.length === 0) {
    console.log('[MyEvent.io] No event sources configured. Scan skipped.');
    return;
  }

  const criteria = await loadCriteria();

  console.log(`[MyEvent.io] Starting scan of ${sources.length} sources...`);

  const scanResults = await processInBatches(
    sources,
    (source) => scrapeSource(source, criteria, userId)
  );

  const totalEvents = scanResults.reduce((s, r) => s + (r.eventsFound || 0), 0);
  const totalMatched = scanResults.reduce((s, r) => s + (r.matched || 0), 0);

  console.log(
    `[MyEvent.io] Scan complete. Found: ${totalEvents}, Matched: ${totalMatched}`
  );

  // Update last scan time
  chrome.storage.local.set({ lastScanTime: Date.now(), lastScanStats: { totalEvents, totalMatched } });

  // Show summary notification only if we found something
  if (totalEvents > 0) {
    await notifyScanComplete(totalEvents, totalMatched);
  }

  // Attempt sync
  await syncAll();
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — BACKEND SYNC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get auth token from storage.
 */
async function getAuthToken() {
  const { authUser } = await chrome.storage.local.get(['authUser']);
  return authUser?.token || null;
}

/**
 * Sync unsynced anomalies to backend.
 */
async function syncAnomalies() {
  const token = await getAuthToken();
  if (!token) return;

  const unsynced = await getUnsyncedAnomalies();
  if (unsynced.length === 0) return;

  try {
    const res = await fetch(`${API_BASE}/api/anomalies/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ anomalies: unsynced }),
    });

    if (res.ok) {
      for (const a of unsynced) {
        await markAnomalySynced(a.id);
      }
      console.log(`[MyEvent.io] Synced ${unsynced.length} anomalies`);
    }
  } catch (err) {
    console.warn('[MyEvent.io] Anomaly sync failed (offline?):', err.message);
  }
}

/**
 * Sync unsynced events to backend.
 */
async function syncEvents() {
  const token = await getAuthToken();
  if (!token) return;

  const unsynced = await getUnsyncedEvents();
  if (unsynced.length === 0) return;

  try {
    const res = await fetch(`${API_BASE}/api/events/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ events: unsynced }),
    });

    if (res.ok) {
      for (const e of unsynced) {
        await markEventSynced(e.id);
      }
      console.log(`[MyEvent.io] Synced ${unsynced.length} events`);
    }
  } catch (err) {
    console.warn('[MyEvent.io] Event sync failed (offline?):', err.message);
  }
}

async function syncAll() {
  try {
    await syncAnomalies();
    await syncEvents();
  } catch (err) {
    console.warn('[MyEvent.io] Sync error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGES from popup
// ─────────────────────────────────────────────────────────────────────────────

// ── URL Intelligence Keywords ─────────────────────────────────────────────────
const EVENT_URL_KEYWORDS = [
  'event', 'meetup', 'conference', 'workshop', 'summit', 'hackathon',
  'webinar', 'seminar', 'bootcamp', 'talk', 'register', 'rsvp', 'attend',
];

/**
 * Score a URL for event relevance (0-100).
 * Higher scores = more likely an event page or event source.
 */
function scoreUrl(url) {
  let score = 0;
  try {
    const parsed  = new URL(url);
    const full    = url.toLowerCase();
    const path    = parsed.pathname.toLowerCase();
    const host    = parsed.hostname.toLowerCase();

    // Known event domains
    const eventDomains = [
      'meetup.com', 'eventbrite.com', 'townscript.com', 'hasgeek.com',
      'konfhub.com', 'bookmyshow.com', 'luma.me', 'lu.ma',
      'gdg.community.dev', 'devfest', 'aws.amazon.com/events',
    ];
    if (eventDomains.some((d) => host.includes(d))) score += 40;

    // Event keywords in URL path
    const kwCount = EVENT_URL_KEYWORDS.filter((k) => full.includes(k)).length;
    score += Math.min(kwCount * 10, 40);

    // Bangalore signals
    if (full.includes('bangalore') || full.includes('bengaluru') || full.includes('/blr')) {
      score += 15;
    }

    // Cap
    score = Math.min(score, 100);
  } catch { /* ignore */ }
  return score;
}

/**
 * Record a URL visit to the activity log (chrome.storage, capped at 500 entries).
 * High-scoring URLs get promoted as recommended event sources.
 */
async function recordUrlVisit(url, title) {
  if (!url || url.startsWith('chrome') || url.startsWith('about:')) return;

  const score = scoreUrl(url);

  try {
    const { urlActivity = [], interestProfile = {} } = await chrome.storage.local.get([
      'urlActivity',
      'interestProfile',
    ]);

    // Append to activity log (newest first, cap at 500)
    urlActivity.unshift({ url, title, score, timestamp: Date.now() });
    if (urlActivity.length > 500) urlActivity.length = 500;

    // Update interest profile domain counts
    try {
      const host = new URL(url).hostname;
      interestProfile[host] = (interestProfile[host] || 0) + 1;
    } catch { /* ignore */ }

    await chrome.storage.local.set({ urlActivity, interestProfile });

    // If score >= 15, auto-suggest as event source (stored separately for popup)
    if (score >= 15) {
      const { suggestedSources = [] } = await chrome.storage.local.get(['suggestedSources']);
      const alreadySuggested = suggestedSources.some((s) => s.url === url);
      if (!alreadySuggested) {
        suggestedSources.unshift({ url, name: title || getSiteName(url), score, timestamp: Date.now() });
        if (suggestedSources.length > 50) suggestedSources.length = 50;
        await chrome.storage.local.set({ suggestedSources });
        console.log(`[MyEvent.io] Suggested event source (score ${score}): ${url}`);
      }
    }

    // Sync high-value activity to backend
    if (score >= 10) {
      syncUrlLog(url, title, score).catch(() => {});
    }
  } catch (err) {
    console.warn('[MyEvent.io] recordUrlVisit error:', err.message);
  }
}

/**
 * POST a single URL log entry to the backend (non-blocking, offline-safe).
 */
async function syncUrlLog(url, title, score) {
  const token = await getAuthToken();
  if (!token) return;

  try {
    await fetch(`${API_BASE}/api/url-log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url,
        title: title || '',
        score,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch { /* offline — skip silently */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAGE_VISIT') {
    // Fired by content.js on every page load / SPA navigation
    recordUrlVisit(msg.url, msg.title).catch(() => {});
    // No async response needed
    return false;
  }

  if (msg.type === 'SCAN_NOW') {
    runDailyScan()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async
  }

  if (msg.type === 'SYNC_NOW') {
    syncAll()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (msg.type === 'GET_STATS') {
    chrome.storage.local.get(
      ['lastScanTime', 'lastScanStats', 'event_sources', 'suggestedSources'],
      (data) => {
        sendResponse({
          lastScanTime:    data.lastScanTime || null,
          lastScanStats:   data.lastScanStats || { totalEvents: 0, totalMatched: 0 },
          sourcesCount:    (data.event_sources || []).length,
          suggestedCount:  (data.suggestedSources || []).length,
        });
      }
    );
    return true;
  }

  if (msg.type === 'GET_INTEREST_PROFILE') {
    chrome.storage.local.get(['interestProfile', 'urlActivity', 'suggestedSources'], (data) => {
      // Sort domains by visit count, return top 10
      const domains = Object.entries(data.interestProfile || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([domain, count]) => ({ domain, count }));
      sendResponse({
        topDomains:      domains,
        recentActivity:  (data.urlActivity || []).slice(0, 20),
        suggestedSources:(data.suggestedSources || []).slice(0, 10),
      });
    });
    return true;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INSTALL / STARTUP
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[MyEvent.io] Installed/Updated:', details.reason);
  await openDB();
  registerDailyAlarm();
  registerSyncAlarm();

  // Default settings
  const { settings } = await chrome.storage.local.get(['settings']);
  if (!settings) {
    await chrome.storage.local.set({
      settings: {
        autoRedirect: true,
        scanTime: '08:00',
        criteria: {
          location: 'Bangalore',
          event_type: 'In-Person',
          cost: 'Free',
        },
      },
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[MyEvent.io] Browser startup');
  await openDB();
  registerDailyAlarm();
  registerSyncAlarm();
});

// getSiteName is defined at the top of this file and shared with all callers.
