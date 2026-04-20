/**
 * db.js — IndexedDB Helper for MyEvent.io
 * Manages two object stores: "url_anomalies" and "events"
 */

const DB_NAME = 'myeventio_db';
const DB_VERSION = 1;

let _db = null;

/** Open (or upgrade) the IndexedDB database. Returns a Promise<IDBDatabase>. */
export function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // ── url_anomalies store ───────────────────────────────────────────────
      if (!db.objectStoreNames.contains('url_anomalies')) {
        const s = db.createObjectStore('url_anomalies', {
          keyPath: 'id',
          autoIncrement: true,
        });
        s.createIndex('user_id', 'user_id', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
        s.createIndex('original_url', 'original_url', { unique: false });
      }

      // ── events store ──────────────────────────────────────────────────────
      if (!db.objectStoreNames.contains('events')) {
        const e = db.createObjectStore('events', {
          keyPath: 'id',
          autoIncrement: true,
        });
        e.createIndex('user_id', 'user_id', { unique: false });
        e.createIndex('source_url', 'source_url', { unique: false });
        e.createIndex('scraped_at', 'scraped_at', { unique: false });
        e.createIndex('matched_criteria', 'matched_criteria', { unique: false });
        e.createIndex('title_date_source', ['title', 'date', 'source_url'], {
          unique: false,
        });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };

    req.onerror = (e) => {
      reject(e.target.error);
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic helpers
// ─────────────────────────────────────────────────────────────────────────────

function txStore(db, storeName, mode) {
  const tx = db.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function cursorToArray(req) {
  return new Promise((resolve, reject) => {
    const results = [];
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// URL ANOMALIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a new URL anomaly record.
 * @param {Object} anomaly - { original_url, corrected_url, timestamp, user_id, site_name, status }
 * @returns {Promise<number>} - inserted record id
 */
export async function addAnomaly(anomaly) {
  const db = await openDB();
  const store = txStore(db, 'url_anomalies', 'readwrite');
  return requestToPromise(store.add(anomaly));
}

/**
 * Get all URL anomalies for a user, sorted by timestamp descending.
 */
export async function getAnomalies(userId) {
  const db = await openDB();
  const store = txStore(db, 'url_anomalies', 'readonly');
  const all = await cursorToArray(store.openCursor());
  return all
    .filter((a) => !userId || a.user_id === userId)
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Get unsynced anomalies (status !== 'synced').
 */
export async function getUnsyncedAnomalies() {
  const db = await openDB();
  const store = txStore(db, 'url_anomalies', 'readonly');
  const all = await cursorToArray(store.openCursor());
  return all.filter((a) => a.status !== 'synced');
}

/**
 * Mark anomaly as synced.
 */
export async function markAnomalySynced(id) {
  const db = await openDB();
  const store = txStore(db, 'url_anomalies', 'readwrite');
  const record = await requestToPromise(store.get(id));
  if (record) {
    record.status = 'synced';
    return requestToPromise(store.put(record));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a duplicate event already exists (same title + date + source_url).
 */
export async function isDuplicateEvent(title, date, source_url) {
  const db = await openDB();
  const store = txStore(db, 'events', 'readonly');
  const all = await cursorToArray(store.openCursor());
  return all.some(
    (e) =>
      e.title === title &&
      e.date === date &&
      e.source_url === source_url
  );
}

/**
 * Insert a new event record.
 * @param {Object} event
 */
export async function addEvent(event) {
  const db = await openDB();
  const store = txStore(db, 'events', 'readwrite');
  return requestToPromise(store.add(event));
}

/**
 * Get all events optionally filtered by user_id, sorted by date asc.
 */
export async function getEvents(userId) {
  const db = await openDB();
  const store = txStore(db, 'events', 'readonly');
  const all = await cursorToArray(store.openCursor());
  return all
    .filter((e) => !userId || e.user_id === userId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Get matched events (all 3 criteria match).
 */
export async function getMatchedEvents(userId) {
  const events = await getEvents(userId);
  return events.filter((e) => e.matched_criteria === true);
}

/**
 * Mark event as notified.
 */
export async function markEventNotified(id) {
  const db = await openDB();
  const store = txStore(db, 'events', 'readwrite');
  const record = await requestToPromise(store.get(id));
  if (record) {
    record.notified = true;
    return requestToPromise(store.put(record));
  }
}

/**
 * Get unsynced events.
 */
export async function getUnsyncedEvents() {
  const db = await openDB();
  const store = txStore(db, 'events', 'readonly');
  const all = await cursorToArray(store.openCursor());
  return all.filter((e) => !e.synced);
}

/**
 * Mark event as synced.
 */
export async function markEventSynced(id) {
  const db = await openDB();
  const store = txStore(db, 'events', 'readwrite');
  const record = await requestToPromise(store.get(id));
  if (record) {
    record.synced = true;
    return requestToPromise(store.put(record));
  }
}

/**
 * Clear all events for a fresh scan result (optional utility).
 */
export async function clearEvents() {
  const db = await openDB();
  const store = txStore(db, 'events', 'readwrite');
  return requestToPromise(store.clear());
}

/**
 * Get DB stats: counts per store.
 */
export async function getStats() {
  const db = await openDB();
  const anomalyStore = txStore(db, 'url_anomalies', 'readonly');
  const eventStore = txStore(db, 'events', 'readonly');
  const [anomalyCount, eventCount] = await Promise.all([
    requestToPromise(anomalyStore.count()),
    requestToPromise(eventStore.count()),
  ]);
  return { anomalyCount, eventCount };
}
