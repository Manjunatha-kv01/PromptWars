/**
 * scraper.js — Event Extraction Logic
 * Parses raw HTML strings (using DOMParser) and extracts event data.
 * Designed to run in the service worker context.
 */

// ── Keyword patterns ──────────────────────────────────────────────────────────
const EVENT_KEYWORDS = [
  'event', 'conference', 'workshop', 'meetup', 'summit', 'webinar',
  'hackathon', 'register', 'rsvp', 'attend', 'bootcamp', 'seminar',
  'symposium', 'expo', 'forum', 'talk', 'lecture', 'sprint',
];

const LOCATION_KEYWORDS = {
  bangalore: ['bangalore', 'bengaluru', 'blr', 'india'],
  online: ['online', 'virtual', 'remote', 'zoom', 'teams', 'webex', 'digital'],
};

const FREE_KEYWORDS = [
  'free', '₹0', '$0', '0 usd', 'no fee', 'complimentary', 'no charge',
  'free of charge', 'free entry', 'free admission', 'free registration',
  'free to attend', 'free event',
];

// ── Date patterns ─────────────────────────────────────────────────────────────
const DATE_PATTERNS = [
  // DD Mon YYYY or D Mon YYYY
  /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi,
  // Mon DD, YYYY
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/gi,
  // YYYY-MM-DD
  /\b(\d{4})-(\d{2})-(\d{2})\b/g,
  // DD/MM/YYYY or MM/DD/YYYY
  /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
];

/**
 * Extract a date string from a block of text.
 * Returns ISO string or raw matched string, or null.
 */
function extractDate(text) {
  for (const pattern of DATE_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      const raw = match[0];
      const parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
      return raw;
    }
  }
  return null;
}

/**
 * Determine location type from text.
 * Returns "In-Person", "Online/Virtual", or "Unknown"
 */
function extractLocationType(text) {
  const lower = text.toLowerCase();
  const isBangalore = LOCATION_KEYWORDS.bangalore.some((k) => lower.includes(k));
  const isOnline = LOCATION_KEYWORDS.online.some((k) => lower.includes(k));

  if (isBangalore) return { type: 'In-Person', location: 'Bangalore, India' };
  if (isOnline) return { type: 'Online/Virtual', location: 'Online' };
  return { type: 'Unknown', location: extractLocationSnippet(text) };
}

/**
 * Try to pluck a meaningful location snippet from text.
 */
function extractLocationSnippet(text) {
  // Look for "at <City>" or "in <City>" patterns
  const match = text.match(/\b(?:at|in|location[:\s]+)\s+([A-Z][a-zA-Z\s,]{2,30})/);
  return match ? match[1].trim() : 'Unknown';
}

/**
 * Determine cost from text.
 * Returns "Free" or "Paid"
 */
function extractCost(text) {
  const lower = text.toLowerCase();
  if (FREE_KEYWORDS.some((k) => lower.includes(k))) return 'Free';
  return 'Paid';
}

/**
 * Check if a text block contains event-related keywords.
 */
function hasEventKeyword(text) {
  const lower = text.toLowerCase();
  return EVENT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Get the nearest heading (h1/h2/h3) to a DOM element.
 */
function getNearestHeading(el) {
  // Walk up to find a parent section or article that has a heading
  let current = el;
  for (let i = 0; i < 5; i++) {
    if (!current || !current.parentElement) break;
    current = current.parentElement;
    const heading = current.querySelector('h1, h2, h3, h4');
    if (heading && heading.textContent.trim().length > 3) {
      return heading.textContent.trim().slice(0, 120);
    }
  }
  // Fall back to own text content
  const ownText = el.textContent.trim();
  return ownText.slice(0, 120) || 'Untitled Event';
}

/**
 * Score how likely an element is an event block (0-100).
 */
function scoreElement(el) {
  const text = el.textContent || '';
  const lower = text.toLowerCase();
  let score = 0;

  // Has event keywords
  const kwCount = EVENT_KEYWORDS.filter((k) => lower.includes(k)).length;
  score += kwCount * 15;

  // Has a date
  if (extractDate(text)) score += 25;

  // Has location
  const locKeys = [...LOCATION_KEYWORDS.bangalore, ...LOCATION_KEYWORDS.online];
  if (locKeys.some((k) => lower.includes(k))) score += 20;

  // Has free keyword
  if (FREE_KEYWORDS.some((k) => lower.includes(k))) score += 10;

  // Has a heading nearby
  if (el.querySelector && el.querySelector('h1, h2, h3, h4')) score += 10;

  return Math.min(score, 100);
}

/**
 * Main extraction function.
 * @param {string} html - Raw HTML string
 * @param {string} sourceUrl - URL of the source page
 * @param {string} sourceName - Display name of the source
 * @param {string} userId - Authenticated user ID
 * @returns {Array<Object>} - Array of extracted event objects
 */
export function extractEvents(html, sourceUrl, sourceName, userId) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // ── Remove noise elements ─────────────────────────────────────────────────
  ['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript'].forEach(
    (tag) => doc.querySelectorAll(tag).forEach((el) => el.remove())
  );

  // ── Candidate selectors in priority order ─────────────────────────────────
  const candidateSelectors = [
    '[class*="event"]',
    '[class*="Event"]',
    '[id*="event"]',
    '[data-event]',
    'article',
    '.card',
    '[class*="card"]',
    '[class*="meetup"]',
    '[class*="conference"]',
    '[class*="workshop"]',
    'li',
    'section',
  ];

  const seen = new Set();
  const candidates = [];

  for (const sel of candidateSelectors) {
    try {
      const els = doc.querySelectorAll(sel);
      els.forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          const text = el.textContent.trim();
          if (text.length > 30 && text.length < 5000 && hasEventKeyword(text)) {
            candidates.push(el);
          }
        }
      });
    } catch (_) {
      // Ignore invalid selectors
    }
  }

  // ── Score and deduplicate ─────────────────────────────────────────────────
  const scored = candidates
    .map((el) => ({ el, score: scoreElement(el) }))
    .filter((item) => item.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 30); // Cap at 30 candidates per page

  const events = [];
  const seenTitles = new Set();

  for (const { el } of scored) {
    const text = el.textContent.trim();
    const title = getNearestHeading(el);
    const date = extractDate(text);
    const { type: event_type, location } = extractLocationType(text);
    const cost = extractCost(text);

    // Skip if no date found (weak signal)
    if (!date) continue;

    // Deduplicate by title+date
    const key = `${title}|${date}`;
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);

    events.push({
      title,
      date,
      location,
      event_type,
      cost,
      source_url: sourceUrl,
      source_name: sourceName,
      scraped_at: new Date().toISOString(),
      user_id: userId || null,
      matched_criteria: false,
      notified: false,
      synced: false,
    });
  }

  return events;
}

/**
 * Fetch a page's HTML with a 10-second timeout.
 * @param {string} url
 * @returns {Promise<string|null>}
 */
export async function fetchPageHTML(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      credentials: 'omit',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; MyEventBot/1.0; +https://myevent.io)',
      },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn(`[scraper] Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}
