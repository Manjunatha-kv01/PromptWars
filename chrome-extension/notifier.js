/**
 * notifier.js — Criteria Check & Chrome Notifications
 * Evaluates events against user criteria and fires Chrome notifications.
 */

/**
 * Default criteria if nothing is saved.
 */
export const DEFAULT_CRITERIA = {
  location: 'Bangalore',
  event_type: 'In-Person',
  cost: 'Free',
};

/**
 * Load user criteria from chrome.storage.local.
 * @returns {Promise<Object>}
 */
export async function loadCriteria() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['criteria'], (data) => {
      resolve(data.criteria || DEFAULT_CRITERIA);
    });
  });
}

/**
 * Check if an event matches the user's criteria.
 * @param {Object} event
 * @param {Object} criteria
 * @returns {boolean}
 */
export function matchesCriteria(event, criteria) {
  const loc = (event.location || '').toLowerCase();
  const criteriaLoc = (criteria.location || 'bangalore').toLowerCase();

  const locationMatch =
    loc.includes(criteriaLoc) ||
    loc.includes('bangalore') ||
    loc.includes('bengaluru');

  const typeMatch =
    criteria.event_type === 'Any' ||
    event.event_type === criteria.event_type;

  const costMatch =
    criteria.cost === 'Any' ||
    event.cost === criteria.cost;

  return locationMatch && typeMatch && costMatch;
}

/**
 * Send a Chrome notification for a matched event.
 * @param {Object} event
 * @returns {Promise<string>} notification ID
 */
export async function notifyMatchedEvent(event) {
  const notifId = `event_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  const dateStr = event.date
    ? new Date(event.date).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : 'Date TBD';

  return new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '🎉 New Event Match Found!',
        message: `${event.title} on ${dateStr} at ${event.location} — Free & In-Person`,
        buttons: [{ title: 'View Event' }],
        requireInteraction: false,
        priority: 2,
      },
      (id) => resolve(id)
    );
  });
}

/**
 * Send a Chrome notification for a detected URL typo.
 * @param {string} originalUrl
 * @param {string} correctedUrl
 * @returns {Promise<string>} notification ID
 */
export async function notifyUrlTypo(originalUrl, correctedUrl) {
  const notifId = `typo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '⚠️ URL Typo Detected',
        message: `Did you mean: ${correctedUrl}?`,
        contextMessage: `Original: ${originalUrl}`,
        buttons: [{ title: 'Go to Corrected URL' }, { title: 'Dismiss' }],
        requireInteraction: true,
        priority: 2,
      },
      (id) => {
        // Store the corrected URL keyed by notification ID for click handling
        chrome.storage.local.get(['pendingTypoRedirects'], (data) => {
          const pending = data.pendingTypoRedirects || {};
          pending[id] = { originalUrl, correctedUrl };
          chrome.storage.local.set({ pendingTypoRedirects: pending });
        });
        resolve(id);
      }
    );
  });
}

/**
 * Send a generic scan-complete notification.
 * @param {number} eventsFound
 * @param {number} matched
 */
export async function notifyScanComplete(eventsFound, matched) {
  const notifId = `scan_${Date.now()}`;
  return new Promise((resolve) => {
    chrome.notifications.create(
      notifId,
      {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: '✅ Morning Scan Complete',
        message: `Found ${eventsFound} events. ${matched} match your criteria.`,
        priority: 1,
      },
      (id) => resolve(id)
    );
  });
}
