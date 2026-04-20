/**
 * dashboard.js — MyEvent.io Dashboard SPA
 * Full client-side router, data fetching, rendering for all 4 pages.
 */

'use strict';

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3001'; // local dev — change to 'https://api.myevent.io' for prod

// ── State ─────────────────────────────────────────────────────────────────────
let currentUser  = null;
let allEvents    = [];
let allAnomalies = [];
let dashboardStats = {};

let sortCol = 'date';
let sortDir = 'asc';

// ── SPA Router ────────────────────────────────────────────────────────────────
const PAGES = {
  dashboard: { el: 'page-dashboard', title: 'Dashboard',      nav: 'nav-dashboard' },
  events:    { el: 'page-events',    title: 'All Events',     nav: 'nav-events'    },
  anomalies: { el: 'page-anomalies', title: 'URL Anomalies',  nav: 'nav-anomalies' },
  settings:  { el: 'page-settings', title: 'Settings',       nav: 'nav-settings'  },
  login:     { el: 'page-login',    title: 'Sign In',        nav: null            },
};

function navigateTo(pageKey) {
  const page = PAGES[pageKey];
  if (!page) return;

  // Hide all pages
  document.querySelectorAll('.page').forEach((p) => {
    p.style.display = 'none';
    p.classList.remove('active');
  });

  // Show target page
  const el = document.getElementById(page.el);
  if (el) {
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.classList.add('active');
  }

  // Update topbar title
  document.getElementById('topbar-title').textContent = page.title;

  // Update sidebar nav
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
  if (page.nav) {
    const navEl = document.getElementById(page.nav);
    if (navEl) navEl.classList.add('active');
  }

  // Sidebar on mobile
  document.getElementById('sidebar').classList.remove('mobile-open');

  // Trigger page-specific load
  if (pageKey === 'dashboard') renderDashboard();
  if (pageKey === 'events')    renderEventsTable();
  if (pageKey === 'anomalies') renderAnomaliesTimeline();
  if (pageKey === 'settings')  renderSettings();
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await restoreSession();
  setupEventListeners();
  handleHashNavigation();
});

window.addEventListener('hashchange', handleHashNavigation);

function handleHashNavigation() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  if (!currentUser && hash !== 'login') {
    navigateTo('login');
    return;
  }
  if (currentUser && hash === 'login') {
    navigateTo('dashboard');
    return;
  }
  navigateTo(hash in PAGES ? hash : 'dashboard');
}

// ── Session ───────────────────────────────────────────────────────────────────
async function restoreSession() {
  try {
    const saved = localStorage.getItem('myeventio_user');
    if (saved) {
      currentUser = JSON.parse(saved);
      updateSidebarUser();
      await loadAllData();
    }
  } catch (err) {
    console.error('Session restore failed:', err);
    currentUser = null;
  }
}

function saveSession(user) {
  currentUser = user;
  localStorage.setItem('myeventio_user', JSON.stringify(user));
  updateSidebarUser();
}

function clearSession() {
  currentUser = null;
  localStorage.removeItem('myeventio_user');
  allEvents    = [];
  allAnomalies = [];
}

function updateSidebarUser() {
  if (!currentUser) return;
  const name      = currentUser.name  || 'User';
  const email     = currentUser.email || '';
  const initials  = name.charAt(0).toUpperCase();

  document.getElementById('avatar-initials').textContent = initials;
  document.getElementById('sidebar-name').textContent    = name;
  document.getElementById('sidebar-email').textContent   = email;
  document.getElementById('settings-avatar').textContent = initials;
  document.getElementById('settings-name').textContent   = name;
  document.getElementById('settings-email').textContent  = email;
}

// ── API Calls ─────────────────────────────────────────────────────────────────
async function apiCall(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (currentUser?.token) headers['Authorization'] = `Bearer ${currentUser.token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res    = await fetch(`${API_BASE}${path}`, opts);
  const json   = await res.json();
  if (!res.ok) throw new Error(json.message || json.error || 'API error');
  return json;
}

async function loadAllData() {
  if (!currentUser) return;

  setSyncStatus('loading');
  try {
    const data = await apiCall('GET', `/api/dashboard/${currentUser.user_id}`);
    allEvents    = data.events    || [];
    allAnomalies = data.anomalies || [];
    dashboardStats = data.stats  || {};
    updateBadges();
    setSyncStatus('synced');
  } catch (err) {
    setSyncStatus('error');
    // Fallback to localStorage cache
    try {
      const cached = localStorage.getItem('myeventio_cache');
      if (cached) {
        const d = JSON.parse(cached);
        allEvents    = d.events    || [];
        allAnomalies = d.anomalies || [];
      }
    } catch { /* ignore */ }
  }

  // Cache data locally
  try {
    localStorage.setItem('myeventio_cache', JSON.stringify({ events: allEvents, anomalies: allAnomalies }));
  } catch { /* ignore quota errors */ }
}

function setSyncStatus(state) {
  const dot   = document.querySelector('.sync-dot');
  const label = document.getElementById('sync-label');

  if (state === 'loading') {
    dot.className  = 'sync-dot';
    dot.style.background = 'var(--amber)';
    label.textContent = 'Syncing…';
  } else if (state === 'synced') {
    dot.className  = 'sync-dot';
    dot.style.background = 'var(--green)';
    label.textContent = 'Synced';
  } else if (state === 'error') {
    dot.className  = 'sync-dot error';
    dot.style.background = 'var(--red)';
    label.textContent = 'Offline';
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      if (page) {
        window.location.hash = page;
      }
    });
  });

  // Section link (view all anomalies)
  document.querySelectorAll('[data-page]').forEach((el) => {
    if (!el.classList.contains('nav-item')) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = el.dataset.page;
      });
    }
  });

  // Mobile menu
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  });

  // Refresh
  const refreshBtn = document.getElementById('btn-refresh');
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.classList.add('spinning');
    await loadAllData();
    const cur = window.location.hash.replace('#', '') || 'dashboard';
    navigateTo(cur in PAGES ? cur : 'dashboard');
    refreshBtn.classList.remove('spinning');
    showToast('Data refreshed', 'success');
  });

  // Logout
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('s-btn-logout').addEventListener('click', logout);

  // Login tabs
  document.querySelectorAll('.ltab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ltab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.form;
      document.getElementById('lform-login').style.display  = which === 'login'  ? 'flex' : 'none';
      document.getElementById('lform-signup').style.display = which === 'signup' ? 'flex' : 'none';
    });
  });

  // Login form
  document.getElementById('lform-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleLogin();
  });

  document.getElementById('lform-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleSignup();
  });

  // Events table filters
  ['filter-type', 'filter-cost', 'filter-match', 'filter-search'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', renderEventsTable);
    document.getElementById(id)?.addEventListener('change', renderEventsTable);
  });

  // Table sort
  document.querySelectorAll('.events-table th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortCol === col) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortCol = col;
        sortDir = 'asc';
      }
      renderEventsTable();
    });
  });

  // Save settings
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
async function handleLogin() {
  const email    = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-pass').value;
  const errEl    = document.getElementById('l-error');
  const btn      = document.getElementById('l-btn');

  btn.textContent = 'Signing in…';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const res = await apiCall('POST', '/api/auth/login', { email, password });
    saveSession({ token: res.token, user_id: res.user_id, name: res.name, email: res.email });
    await loadAllData();
    window.location.hash = 'dashboard';
  } catch (err) {
    // Allow offline/local login
    if (err.message.toLowerCase().includes('fetch') || err.message.toLowerCase().includes('network')) {
      saveSession({ token: 'local_' + Date.now(), user_id: 'local_user', name: email.split('@')[0], email });
      window.location.hash = 'dashboard';
    } else {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  } finally {
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

async function handleSignup() {
  const name     = document.getElementById('s-name').value.trim();
  const email    = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-pass').value;
  const errEl    = document.getElementById('s-error');
  const btn      = document.getElementById('s-btn');

  btn.textContent = 'Creating account…';
  btn.disabled = true;
  errEl.style.display = 'none';

  try {
    const res = await apiCall('POST', '/api/auth/signup', { name, email, password });
    saveSession({ token: res.token, user_id: res.user_id, name: res.name, email: res.email });
    await loadAllData();
    window.location.hash = 'dashboard';
  } catch (err) {
    if (err.message.toLowerCase().includes('fetch') || err.message.toLowerCase().includes('network')) {
      saveSession({ token: 'local_' + Date.now(), user_id: 'local_user', name, email });
      window.location.hash = 'dashboard';
    } else {
      errEl.textContent = err.message;
      errEl.style.display = 'block';
    }
  } finally {
    btn.textContent = 'Create Account';
    btn.disabled = false;
  }
}

function logout() {
  clearSession();
  window.location.hash = 'login';
}

// ── BADGE UPDATES ─────────────────────────────────────────────────────────────
function updateBadges() {
  const matched   = allEvents.filter((e) => e.matched_criteria).length;
  const anomCount = allAnomalies.length;

  const evBadge = document.getElementById('nav-events-badge');
  const anBadge = document.getElementById('nav-anomalies-badge');

  evBadge.textContent = allEvents.length;
  evBadge.style.display = allEvents.length > 0 ? 'flex' : 'none';

  anBadge.textContent = anomCount;
  anBadge.style.display = anomCount > 0 ? 'flex' : 'none';

  // KPIs
  setKPI('kpi-matched',   matched);
  setKPI('kpi-total',     allEvents.length);
  setKPI('kpi-anomalies', anomCount);
  setKPI('kpi-sources',   dashboardStats.sources || '—');

  document.getElementById('matched-count-badge').textContent = matched;
}

function setKPI(id, val) {
  const el = document.getElementById(id);
  if (el) animateCount(el, parseInt(el.textContent) || 0, parseInt(val) || 0);
}

function animateCount(el, from, to) {
  if (from === to || isNaN(to)) { el.textContent = to || '—'; return; }
  const duration = 600;
  const start = performance.now();
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + (to - from) * easeOut(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

// ── DASHBOARD PAGE ────────────────────────────────────────────────────────────
function renderDashboard() {
  updateBadges();
  renderMatchedEvents();
  renderRecentAnomalies();
}

function renderMatchedEvents() {
  const grid  = document.getElementById('matched-events-grid');
  const empty = document.getElementById('matched-empty');
  const matched = allEvents.filter((e) => e.matched_criteria)
    .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  grid.innerHTML = '';

  if (matched.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  matched.forEach((evt, i) => {
    const card = buildFullEventCard(evt, i);
    grid.appendChild(card);
  });
}

function buildFullEventCard(evt, index) {
  const card = document.createElement('div');
  card.className = 'event-card-full';
  card.style.animationDelay = `${index * 0.06}s`;

  const dateStr = evt.date
    ? new Date(evt.date).toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' })
    : 'Date TBD';

  const hostname = safeHostname(evt.source_url);
  const typeBadge = evt.event_type === 'In-Person'
    ? '<span class="ecf-badge ecf-badge--purple">🏢 In-Person</span>'
    : '<span class="ecf-badge ecf-badge--blue">💻 Online</span>';
  const costBadge = evt.cost === 'Free'
    ? '<span class="ecf-badge ecf-badge--green">✓ Free</span>'
    : '<span class="ecf-badge ecf-badge--amber">₹ Paid</span>';

  card.innerHTML = `
    <div class="ecf-badge-row">
      ${typeBadge}
      ${costBadge}
      <span class="ecf-badge ecf-badge--blue">📅 ${esc(dateStr)}</span>
    </div>
    <div class="ecf-title">${esc(evt.title)}</div>
    <div class="ecf-meta">
      <div class="ecf-meta-row">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd"/></svg>
        ${esc(evt.location || 'Unknown')}
      </div>
    </div>
    <div class="ecf-footer">
      <span class="ecf-source">${esc(hostname)}</span>
      <a href="${esc(evt.source_url)}" target="_blank" rel="noopener" class="ecf-visit-btn">Visit →</a>
    </div>
  `;

  return card;
}

function renderRecentAnomalies() {
  const list  = document.getElementById('recent-anomalies');
  const empty = document.getElementById('recent-anomalies-empty');
  const recent = allAnomalies.slice(0, 5);

  list.innerHTML = '';

  if (recent.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  recent.forEach((a, i) => {
    const item = document.createElement('div');
    item.className = 'anomaly-preview-item';
    item.style.animationDelay = `${i * 0.05}s`;

    const timeStr = new Date(a.timestamp || a.created_at).toLocaleString('en-IN', {
      day:'numeric', month:'short', hour:'2-digit', minute:'2-digit',
    });

    item.innerHTML = `
      <div class="api-num">${i + 1}</div>
      <div class="api-orig">✗ ${esc(a.original_url)}</div>
      <div class="api-fixed" data-url="${esc(a.corrected_url)}">✓ ${esc(a.corrected_url)}</div>
      <div class="api-time">${timeStr}</div>
    `;

    item.querySelector('.api-fixed').addEventListener('click', (e) => {
      window.open(e.currentTarget.dataset.url, '_blank');
    });

    list.appendChild(item);
  });
}

// ── ALL EVENTS TABLE ──────────────────────────────────────────────────────────
function renderEventsTable() {
  const loading = document.getElementById('events-table-loading');
  const body    = document.getElementById('events-table-body');
  const empty   = document.getElementById('events-table-empty');

  loading.style.display = 'none';
  body.innerHTML = '';

  let events = [...allEvents];

  // Filter
  const typeF   = document.getElementById('filter-type')?.value   || '';
  const costF   = document.getElementById('filter-cost')?.value   || '';
  const matchF  = document.getElementById('filter-match')?.value  || '';
  const searchF = (document.getElementById('filter-search')?.value || '').toLowerCase();

  if (typeF)   events = events.filter((e) => e.event_type === typeF);
  if (costF)   events = events.filter((e) => e.cost === costF);
  if (matchF === 'matched') events = events.filter((e) => e.matched_criteria);
  if (searchF) events = events.filter((e) =>
    (e.title || '').toLowerCase().includes(searchF) ||
    (e.location || '').toLowerCase().includes(searchF)
  );

  // Sort
  events.sort((a, b) => {
    let av = a[sortCol] || '';
    let bv = b[sortCol] || '';
    if (sortCol === 'date') { av = new Date(av || 0); bv = new Date(bv || 0); }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  if (events.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  events.forEach((evt) => {
    const tr = document.createElement('tr');
    const dateStr = evt.date
      ? new Date(evt.date).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })
      : '—';

    const typeBadge = evt.event_type === 'In-Person'
      ? '<span class="badge-cell badge-inperson">In-Person</span>'
      : '<span class="badge-cell badge-online">Online</span>';
    const costBadge = evt.cost === 'Free'
      ? '<span class="badge-cell badge-free">Free</span>'
      : '<span class="badge-cell badge-paid">Paid</span>';
    const matchBadge = evt.matched_criteria
      ? '<span class="badge-cell badge-matched">✓ Match</span>'
      : '';

    tr.innerHTML = `
      <td class="td-title" title="${esc(evt.title)}">${esc(evt.title)} ${matchBadge}</td>
      <td class="td-date">${dateStr}</td>
      <td class="td-location">${esc(evt.location || '—')}</td>
      <td>${typeBadge}</td>
      <td>${costBadge}</td>
      <td class="td-source" title="${esc(evt.source_url)}">${esc(safeHostname(evt.source_url))}</td>
      <td class="td-action"><a href="${esc(evt.source_url)}" target="_blank" rel="noopener">Visit →</a></td>
    `;

    body.appendChild(tr);
  });
}

// ── ANOMALIES TIMELINE ────────────────────────────────────────────────────────
function renderAnomaliesTimeline() {
  const timeline = document.getElementById('anomalies-timeline');
  const empty    = document.getElementById('anomalies-timeline-empty');
  const loading  = document.getElementById('anomalies-timeline-loading');

  loading.style.display  = 'none';
  timeline.innerHTML = '';

  if (allAnomalies.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  allAnomalies.forEach((a, i) => {
    const item    = document.createElement('div');
    item.className = 'timeline-item';
    item.style.animationDelay = `${Math.min(i * 0.05, 1)}s`;

    const timeStr = new Date(a.timestamp || a.created_at).toLocaleString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });

    item.innerHTML = `
      <div class="tl-header">
        <span class="tl-step">Step ${i + 1}</span>
        <span class="tl-site">${esc(a.site_name || safeHostname(a.original_url))}</span>
        <span class="tl-time">${timeStr}</span>
      </div>
      <div class="tl-orig">
        <span class="tl-orig-label">Original</span>
        <span class="tl-orig-url">${esc(a.original_url)}</span>
      </div>
      <div class="tl-fixed" data-url="${esc(a.corrected_url)}">
        <span class="tl-fixed-label">Corrected</span>
        <span class="tl-fixed-url">${esc(a.corrected_url)}</span>
      </div>
      <div class="tl-status">● ${esc(a.status || 'detected')}</div>
    `;

    item.querySelector('.tl-fixed').addEventListener('click', (e) => {
      const url = e.currentTarget.dataset.url;
      window.open(url, '_blank');
    });

    timeline.appendChild(item);
  });
}

// ── SETTINGS PAGE ─────────────────────────────────────────────────────────────
function renderSettings() {
  updateSidebarUser();

  const saved = JSON.parse(localStorage.getItem('myeventio_settings') || '{}');
  const criteria = saved.criteria || {};

  document.getElementById('s-crit-location').value = criteria.location   || 'Bangalore';
  document.getElementById('s-crit-type').value     = criteria.event_type || 'In-Person';
  document.getElementById('s-crit-cost').value     = criteria.cost       || 'Free';
  document.getElementById('s-scan-time').value     = saved.scanTime      || '08:00';
  document.getElementById('s-auto-redirect').checked = saved.autoRedirect ?? true;
}

function saveSettings() {
  const settings = {
    criteria: {
      location:   document.getElementById('s-crit-location').value.trim(),
      event_type: document.getElementById('s-crit-type').value,
      cost:       document.getElementById('s-crit-cost').value,
    },
    scanTime:    document.getElementById('s-scan-time').value,
    autoRedirect: document.getElementById('s-auto-redirect').checked,
  };

  localStorage.setItem('myeventio_settings', JSON.stringify(settings));

  const msg = document.getElementById('settings-saved-msg');
  msg.style.display = 'flex';
  setTimeout(() => { msg.style.display = 'none'; }, 3000);
  showToast('Settings saved successfully', 'success');
}

// ── TOAST ─────────────────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className   = 'toast' + (type ? ' ' + type : '');
  toast.style.display = 'block';

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ── UTILITIES ─────────────────────────────────────────────────────────────────
function safeHostname(url) {
  try { return new URL(url).hostname; }
  catch { return url || '—'; }
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
