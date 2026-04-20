/**
 * popup.js — MyEvent.io Extension Popup (ES Module)
 * Full auth flow, bookmark manager, events display, anomalies timeline, settings.
 */

import {
  openDB,
  getEvents,
  getAnomalies,
} from './db.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = 'https://api.myevent.io'; // swap to http://localhost:3001 for dev

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser       = null;
let allBookmarks      = [];
let selectedSources   = [];
let filteredBookmarks = [];

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  await restoreSession();
});

async function restoreSession() {
  const data = await storageGet(['authUser']);
  if (data.authUser && data.authUser.token) {
    currentUser = data.authUser;
    showMainApp();
  } else {
    showAuthScreen();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
function showAuthScreen() {
  document.getElementById('screen-auth').classList.add('active');
  document.getElementById('screen-main').style.display = 'none';
  setupAuthUI();
}

function showMainApp() {
  document.getElementById('screen-auth').classList.remove('active');
  document.getElementById('screen-auth').style.display = 'none';
  const main = document.getElementById('screen-main');
  main.style.display = 'flex';
  initMainApp();
}

function setupAuthUI() {
  document.querySelectorAll('.auth-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.auth;
      document.getElementById('form-login').style.display  = which === 'login'  ? 'flex' : 'none';
      document.getElementById('form-signup').style.display = which === 'signup' ? 'flex' : 'none';
    });
  });

  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAuth('login', {
      email:    document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value,
    });
  });

  document.getElementById('form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleAuth('signup', {
      name:     document.getElementById('signup-name').value.trim(),
      email:    document.getElementById('signup-email').value.trim(),
      password: document.getElementById('signup-password').value,
    });
  });
}

async function handleAuth(type, payload) {
  const isLogin = type === 'login';
  const btnId   = isLogin ? 'btn-login'  : 'btn-signup';
  const errId   = isLogin ? 'login-error': 'signup-error';
  const btn     = document.getElementById(btnId);
  const errEl   = document.getElementById(errId);
  const label   = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.btn-spinner');

  label.style.display   = 'none';
  spinner.style.display = 'block';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const res  = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Authentication failed');

    currentUser = {
      token:   json.token,
      user_id: json.user_id,
      name:    json.name  || payload.name || payload.email.split('@')[0],
      email:   json.email || payload.email,
    };
    await storageSet({ authUser: currentUser });
    showMainApp();

  } catch (err) {
    // Offline / dev mode — allow local-only session
    if (err.message.includes('fetch') || err.message.includes('network') ||
        err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
      currentUser = {
        token:   'local_' + Date.now(),
        user_id: 'local_user',
        name:    payload.name || (payload.email || 'User').split('@')[0],
        email:   payload.email || 'local@myevent.io',
      };
      await storageSet({ authUser: currentUser });
      showMainApp();
      return;
    }
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    label.style.display   = 'inline';
    spinner.style.display = 'none';
    btn.disabled = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP INIT
// ─────────────────────────────────────────────────────────────────────────────
function initMainApp() {
  setupTabNavigation();
  setupHeaderButtons();
  setupScanButton();
  loadStats();
  loadEventsTab();
  setupAnomaliesTab();
  setupSettingsTab();
  populateAccountInfo();
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function setupTabNavigation() {
  document.querySelectorAll('.main-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.main-tab').forEach((t)   => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p)  => p.classList.remove('active'));
      tab.classList.add('active');

      const panel = document.getElementById('tab-' + tab.dataset.tab);
      if (panel) panel.classList.add('active');

      // Lazy-load per tab
      if (tab.dataset.tab === 'bookmarks') setupBookmarksTab();
      if (tab.dataset.tab === 'anomalies') loadAnomaliesTab();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────────────────
function setupHeaderButtons() {
  document.getElementById('btn-open-dashboard').addEventListener('click', () => {
    // Open dash at relative path inside extension (or external URL)
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await storageSet({ authUser: null });
    currentUser = null;
    // Re-show auth screen
    document.getElementById('screen-main').style.display = 'none';
    document.getElementById('screen-auth').style.display = 'flex';
    document.getElementById('screen-auth').classList.add('active');
    setupAuthUI();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN BUTTON
// ─────────────────────────────────────────────────────────────────────────────
function setupScanButton() {
  const scanBtn = document.getElementById('btn-scan-now');
  if (!scanBtn) return;

  scanBtn.addEventListener('click', () => {
    scanBtn.disabled = true;
    scanBtn.classList.add('scanning');

    chrome.runtime.sendMessage({ type: 'SCAN_NOW' }, async () => {
      scanBtn.disabled = false;
      scanBtn.classList.remove('scanning');
      await loadStats();
      await loadEventsTab();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────
async function loadStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (resp) => {
    if (!resp) return;
    document.getElementById('stat-sources').textContent  = resp.sourcesCount || 0;
    document.getElementById('stat-total').textContent    = resp.lastScanStats?.totalEvents  || 0;
    document.getElementById('stat-matched').textContent  = resp.lastScanStats?.totalMatched || 0;

    if (resp.lastScanTime) {
      const d = new Date(resp.lastScanTime);
      document.getElementById('last-scan-label').textContent =
        'Last scan: ' + d.toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
        });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS TAB
// ─────────────────────────────────────────────────────────────────────────────
async function loadEventsTab() {
  const loading = document.getElementById('events-loading');
  const list    = document.getElementById('events-list');
  const empty   = document.getElementById('events-empty');

  list.innerHTML = '';
  loading.style.display = 'flex';

  try {
    const events  = await getEvents(currentUser?.user_id);
    const matched = events.filter((e) => e.matched_criteria);

    loading.style.display = 'none';

    if (matched.length === 0) {
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    matched.slice(0, 15).forEach((evt, i) => {
      list.appendChild(buildEventCard(evt, i));
    });
  } catch (err) {
    console.error('[popup] loadEventsTab error:', err);
    loading.style.display = 'none';
    empty.style.display = 'flex';
  }
}

function buildEventCard(event, index) {
  const card = document.createElement('div');
  card.className = 'event-card';
  card.style.animationDelay = `${index * 0.05}s`;

  const dateStr = event.date
    ? new Date(event.date).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'short', year: 'numeric',
      })
    : 'Date TBD';

  const typeClass = event.event_type === 'In-Person' ? 'chip-inperson' : 'chip-online';
  const costClass = event.cost === 'Free' ? 'chip-free' : 'chip-paid';
  const hostname  = safeHostname(event.source_url);

  card.innerHTML = `
    <div class="event-card__title">${escHtml(event.title)}</div>
    <div class="event-card__meta">
      <span class="event-chip chip-date">📅 ${escHtml(dateStr)}</span>
      <span class="event-chip chip-place">📍 ${escHtml(event.location || 'Unknown')}</span>
      <span class="event-chip ${typeClass}">${escHtml(event.event_type || '?')}</span>
      <span class="event-chip ${costClass}">${escHtml(event.cost || 'Unknown')}</span>
    </div>
    <div class="event-card__source">🔗 ${escHtml(hostname)}</div>
  `;

  card.addEventListener('click', () => chrome.tabs.create({ url: event.source_url }));
  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKMARKS TAB
// ─────────────────────────────────────────────────────────────────────────────
let bookmarkTabSetup = false;

function setupBookmarksTab() {
  if (bookmarkTabSetup) return;
  bookmarkTabSetup = true;

  document.getElementById('btn-load-bookmarks').addEventListener('click', loadAllBookmarks);
  document.getElementById('bookmark-search').addEventListener('input', filterBookmarks);
  document.getElementById('btn-save-sources').addEventListener('click', saveSelectedSources);

  storageGet(['event_sources']).then((data) => {
    selectedSources = (data.event_sources || []).map((s) => s.url);
    updateSourcesCountLabel();
  });
}

async function loadAllBookmarks() {
  const loading = document.getElementById('bookmarks-loading');
  const list    = document.getElementById('bookmarks-list');
  const empty   = document.getElementById('bookmarks-empty');
  const saveBtn = document.getElementById('btn-save-sources');

  loading.style.display = 'flex';
  list.innerHTML = '';

  try {
    const tree = await new Promise((res) => chrome.bookmarks.getTree(res));
    allBookmarks = flattenBookmarks(tree);
    filteredBookmarks = [...allBookmarks];

    loading.style.display = 'none';

    if (allBookmarks.length === 0) {
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';
    saveBtn.style.display = 'block';
    renderBookmarkList(filteredBookmarks);
  } catch (err) {
    loading.style.display = 'none';
    empty.style.display = 'flex';
    console.error('[popup] Bookmarks error:', err);
  }
}

function flattenBookmarks(nodes, result = []) {
  for (const node of nodes) {
    if (node.url) result.push({ id: node.id, title: node.title || node.url, url: node.url });
    if (node.children) flattenBookmarks(node.children, result);
  }
  return result;
}

function renderBookmarkList(bookmarks) {
  const list = document.getElementById('bookmarks-list');
  list.innerHTML = '';

  bookmarks.slice(0, 400).forEach((bm, i) => {
    const item = document.createElement('div');
    item.className = 'bookmark-item' + (selectedSources.includes(bm.url) ? ' selected' : '');
    item.style.animationDelay = `${Math.min(i * 0.015, 0.4)}s`;

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(bm.url)}&sz=16`;
    const hostname   = safeHostname(bm.url);

    item.innerHTML = `
      <input type="checkbox" class="bookmark-checkbox" data-url="${escHtml(bm.url)}"
             ${selectedSources.includes(bm.url) ? 'checked' : ''} />
      <img class="bookmark-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'" />
      <div class="bookmark-info">
        <div class="bookmark-title">${escHtml(bm.title)}</div>
        <div class="bookmark-url">${escHtml(hostname)}</div>
      </div>
    `;

    const checkbox = item.querySelector('.bookmark-checkbox');
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        if (!selectedSources.includes(bm.url)) selectedSources.push(bm.url);
        item.classList.add('selected');
      } else {
        selectedSources = selectedSources.filter((u) => u !== bm.url);
        item.classList.remove('selected');
      }
      updateSourcesCountLabel();
    });

    item.addEventListener('click', (e) => {
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event('change'));
    });

    list.appendChild(item);
  });
}

function filterBookmarks() {
  const q = document.getElementById('bookmark-search').value.toLowerCase();
  filteredBookmarks = allBookmarks.filter(
    (bm) => bm.title.toLowerCase().includes(q) || bm.url.toLowerCase().includes(q)
  );
  renderBookmarkList(filteredBookmarks);
}

function updateSourcesCountLabel() {
  const n = selectedSources.length;
  document.getElementById('sources-count-label').textContent = `${n} source${n !== 1 ? 's' : ''} selected`;
}

async function saveSelectedSources() {
  const sources = selectedSources.map((url) => ({
    url,
    name: allBookmarks.find((b) => b.url === url)?.title || url,
  }));
  await storageSet({ event_sources: sources });
  document.getElementById('stat-sources').textContent = sources.length;

  const btn = document.getElementById('btn-save-sources');
  const orig = btn.textContent;
  btn.textContent = '✓ Saved!';
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANOMALIES TAB
// ─────────────────────────────────────────────────────────────────────────────
function setupAnomaliesTab() {
  loadAnomalyBadge();
}

async function loadAnomalyBadge() {
  try {
    const anomalies = await getAnomalies(currentUser?.user_id);
    const badge = document.getElementById('anomaly-badge');
    if (anomalies.length > 0) {
      badge.textContent = anomalies.length;
      badge.style.display = 'flex';
    }
  } catch { /* IndexedDB not ready */ }
}

async function loadAnomaliesTab() {
  const loading = document.getElementById('anomalies-loading');
  const list    = document.getElementById('anomalies-list');
  const empty   = document.getElementById('anomalies-empty');

  loading.style.display = 'flex';
  list.innerHTML = '';

  try {
    const anomalies = await getAnomalies(currentUser?.user_id);
    loading.style.display = 'none';

    if (anomalies.length === 0) {
      empty.style.display = 'flex';
      return;
    }
    empty.style.display = 'none';

    anomalies.forEach((a, i) => list.appendChild(buildAnomalyItem(a, i + 1)));
  } catch (err) {
    console.error('[popup] loadAnomaliesTab error:', err);
    loading.style.display = 'none';
    empty.style.display = 'flex';
  }
}

function buildAnomalyItem(anomaly, stepNum) {
  const item = document.createElement('div');
  item.className = 'anomaly-item';

  const time = new Date(anomaly.timestamp).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  item.innerHTML = `
    <div class="anomaly-step">
      <div class="anomaly-num">${stepNum}</div>
      <span style="font-size:11px;font-weight:600;color:var(--text-secondary)">
        ${escHtml(anomaly.site_name || safeHostname(anomaly.original_url))}
      </span>
      <span class="anomaly-time">${time}</span>
    </div>
    <div class="anomaly-url-orig">✗ ${escHtml(anomaly.original_url)}</div>
    <div class="anomaly-url-fixed" data-url="${escHtml(anomaly.corrected_url)}"
         title="Click to open corrected URL">✓ ${escHtml(anomaly.corrected_url)}</div>
    <div class="anomaly-status">● ${escHtml(anomaly.status || 'detected')}</div>
  `;

  item.querySelector('.anomaly-url-fixed').addEventListener('click', (e) => {
    chrome.tabs.create({ url: e.currentTarget.dataset.url });
  });

  return item;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────────────────
let settingsSetup = false;

async function setupSettingsTab() {
  if (settingsSetup) return;
  settingsSetup = true;

  const { settings } = await storageGet(['settings']);
  const s = settings || {};
  const c = s.criteria || {};

  document.getElementById('crit-location').value    = c.location   || 'Bangalore';
  document.getElementById('crit-type').value        = c.event_type || 'In-Person';
  document.getElementById('crit-cost').value        = c.cost       || 'Free';
  document.getElementById('scan-time').value        = s.scanTime   || '08:00';
  document.getElementById('toggle-redirect').checked = s.autoRedirect ?? true;

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const newSettings = {
      autoRedirect: document.getElementById('toggle-redirect').checked,
      scanTime:     document.getElementById('scan-time').value,
      criteria: {
        location:   document.getElementById('crit-location').value.trim(),
        event_type: document.getElementById('crit-type').value,
        cost:       document.getElementById('crit-cost').value,
      },
    };
    await storageSet({ settings: newSettings, criteria: newSettings.criteria });

    const msg = document.getElementById('settings-saved');
    msg.style.display = 'block';
    setTimeout(() => { msg.style.display = 'none'; }, 2200);
  });
}

function populateAccountInfo() {
  if (!currentUser) return;
  const initial = (currentUser.name || 'U').charAt(0).toUpperCase();
  document.getElementById('account-avatar').textContent = initial;
  document.getElementById('account-name').textContent   = currentUser.name  || 'User';
  document.getElementById('account-email').textContent  = currentUser.email || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, resolve));
}
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function safeHostname(url) {
  try { return new URL(url).hostname; }
  catch { return url || ''; }
}
