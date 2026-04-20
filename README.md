
# promptwars-antigravity-app
A functional application built for the PromptWars Virtual hackathon using intent-driven development and Google Antigravity. Includes technical documentation and build-in-public insights.
=======
# MyEvent.io — Smart Event Discovery Platform

> **"myevent.io learns from your bookmarks and automatically finds relevant free, in-person events in Bangalore — then notifies you."**

A full-stack, production-ready Chrome Extension + Web Dashboard + Node.js Backend for intelligent event discovery, URL anomaly detection, and daily automated scanning.

---

## 📁 Project Structure

```
myevent.io/
├── chrome-extension/          # MV3 Chrome Extension
│   ├── manifest.json          # Extension config (MV3, permissions)
│   ├── background.js          # Service Worker: typo detection, daily scanner, sync
│   ├── content.js             # Content script injected into every page
│   ├── popup.html             # Extension popup UI
│   ├── popup.css              # Popup premium dark styles
│   ├── popup.js               # Popup logic: auth, events, bookmarks, settings
│   ├── db.js                  # IndexedDB wrapper (offline-first storage)
│   ├── scraper.js             # HTML event extraction engine (rule-based)
│   ├── notifier.js            # Criteria matching + Chrome notifications
│   └── icons/                 # Extension icons (16, 48, 128px)
│
├── dashboard/                 # Web Dashboard (standalone SPA)
│   ├── index.html             # Full dashboard HTML
│   ├── dashboard.css          # Premium dark theme CSS
│   └── dashboard.js           # SPA router, auth, charts, data rendering
│
├── backend/                   # Node.js + Express API
│   ├── server.js              # Express app, middleware, routes
│   ├── package.json           # Dependencies
│   ├── .env.example           # Environment variable template
│   ├── .env                   # Your local config (DO NOT COMMIT)
│   ├── middleware/
│   │   └── auth.js            # JWT authentication middleware
│   ├── routes/
│   │   ├── auth.js            # POST /api/auth/signup, /login, /verify
│   │   ├── events.js          # GET/POST/DELETE /api/events
│   │   └── anomalies.js       # GET/POST/DELETE /api/anomalies
│   └── db/
│       ├── schema.sql         # PostgreSQL schema (users, events, anomalies)
│       └── migrate.js         # One-shot schema migration script
│
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites

| Tool        | Version  |
|-------------|----------|
| Node.js     | ≥ 18.0.0 |
| PostgreSQL  | ≥ 14     |
| Chrome      | ≥ 115 (MV3 support) |

---

### 1. Backend Setup

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials and a strong JWT_SECRET

# Create the database (if it doesn't exist yet)
psql -U postgres -c "CREATE DATABASE myeventio;"

# Run schema migration
npm run migrate
# ✅ Schema applied successfully.

# Start development server
npm run dev
# [MyEvent.io] Server running on http://localhost:3001
```

**Backend Health Check:**
```
GET http://localhost:3001/health
→ { "status": "ok", "timestamp": "..." }
```

---

### 2. Chrome Extension Setup

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer Mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder

> **Dev API endpoint:** In `chrome-extension/background.js` and `popup.js`, change:
> ```js
> const API_BASE = 'https://api.myevent.io';
> // to:
> const API_BASE = 'http://localhost:3001';
> ```

---

### 3. Dashboard Setup

The dashboard is a pure HTML/CSS/JS SPA — no build step needed.

**Option A — Open directly in browser:**
```bash
open dashboard/index.html
```

**Option B — Serve locally (avoids CORS issues):**
```bash
npx serve dashboard -p 3000
# open http://localhost:3000
```

**Option C — From the Extension:**  
Click the grid icon (⊞) in the extension popup → opens the dashboard in a new tab.

> **Dev API endpoint:** In `dashboard/dashboard.js`, update:
> ```js
> const API_BASE = 'http://localhost:3001';
> ```

---

## 🧩 System Architecture (End-to-End Flow)

```
User Browsing
     ↓
Chrome Extension (MV3)
  ├── content.js → reports URL visits to background
  └── background.js → detects double-dot typos (webNavigation)
     ↓
IndexedDB (Offline Storage)
  ├── url_anomalies store
  └── events store
     ↓
Daily Alarm (8:00 AM via chrome.alarms)
  └── background.js → runDailyScan()
       ├── Fetches HTML from each bookmark source
       ├── scraper.js → extracts event candidates
       ├── notifier.js → matchesCriteria() check
       │     ├── Location: Bangalore ✅
       │     ├── Type: In-Person ✅
       │     └── Cost: Free ✅
       └── Chrome push notification on match
     ↓
Background Sync (every 30 min)
  └── POST /api/events/sync → PostgreSQL
  └── POST /api/anomalies/sync → PostgreSQL
     ↓
Web Dashboard
  └── GET /api/dashboard/:uid → renders all data
       ├── KPI cards
       ├── Matched Events grid
       ├── URL Anomaly timeline
       └── Settings
```

---

## 🔌 API Reference

### Auth

| Method | Endpoint              | Body                          | Response             |
|--------|-----------------------|-------------------------------|----------------------|
| POST   | `/api/auth/signup`    | `{name, email, password}`     | `{token, user_id}`   |
| POST   | `/api/auth/login`     | `{email, password}`           | `{token, user_id}`   |
| POST   | `/api/auth/verify`    | `Authorization: Bearer <JWT>` | `{valid, user}`      |

### Events

| Method | Endpoint              | Auth | Notes                           |
|--------|-----------------------|------|---------------------------------|
| POST   | `/api/events/sync`    | ✅   | Bulk upsert from extension      |
| GET    | `/api/events`         | ✅   | `?matched=true&limit=100`       |
| DELETE | `/api/events/:id`     | ✅   | Delete a single event           |

### URL Anomalies

| Method | Endpoint                | Auth | Notes                         |
|--------|-------------------------|------|-------------------------------|
| POST   | `/api/anomalies/sync`   | ✅   | Bulk upsert from extension    |
| GET    | `/api/anomalies`        | ✅   | `?limit=100&offset=0`         |
| DELETE | `/api/anomalies/:id`    | ✅   | Delete a single anomaly       |

### Dashboard

| Method | Endpoint                 | Auth | Notes                              |
|--------|--------------------------|------|------------------------------------|
| GET    | `/api/dashboard/:uid`    | ✅   | Returns events + anomalies + stats |

---

## 🗄️ Database Schema

### `users`
| Column         | Type        | Notes               |
|----------------|-------------|---------------------|
| id             | UUID (PK)   | auto-generated      |
| name           | VARCHAR     |                     |
| email          | VARCHAR     | unique              |
| password_hash  | TEXT        | bcrypt              |
| created_at     | TIMESTAMPTZ |                     |

### `events`
| Column           | Type        | Notes                              |
|------------------|-------------|------------------------------------|
| id               | UUID (PK)   |                                    |
| user_id          | UUID (FK)   | → users.id                         |
| title            | TEXT        |                                    |
| date             | DATE        | nullable                           |
| location         | TEXT        |                                    |
| event_type       | VARCHAR     | `In-Person` / `Online/Virtual`     |
| cost             | VARCHAR     | `Free` / `Paid`                    |
| source_url       | TEXT        |                                    |
| source_name      | TEXT        |                                    |
| matched_criteria | BOOLEAN     | true if passes all 3 filters       |
| notified         | BOOLEAN     |                                    |
| scraped_at       | TIMESTAMPTZ |                                    |

### `url_anomalies`
| Column         | Type        | Notes                                       |
|----------------|-------------|---------------------------------------------|
| id             | UUID (PK)   |                                             |
| user_id        | UUID (FK)   | → users.id                                  |
| original_url   | TEXT        | The malformed URL detected                  |
| corrected_url  | TEXT        | Suggested fix                               |
| site_name      | VARCHAR     | Hostname                                    |
| status         | VARCHAR     | `detected` / `synced` / `dismissed`         |
| timestamp      | TIMESTAMPTZ |                                             |

### `refresh_tokens`
| Column     | Type        |
|------------|-------------|
| id         | UUID (PK)   |
| user_id    | UUID (FK)   |
| token      | TEXT        |
| expires_at | TIMESTAMPTZ |

---

## 🔔 Notification Types

| Event                  | Trigger                              | Chrome Notification                         |
|------------------------|--------------------------------------|---------------------------------------------|
| **URL Typo Detected**  | User visits a `..` double-dot URL    | Shows original → corrected, button to open  |
| **Event Match Found**  | Scan finds Free+In-Person+Bangalore  | Shows event title, date, location           |
| **Daily Scan Done**    | 8 AM alarm completes                 | Summary: `X events found, Y matched`        |

---

## ⚙️ Event Matching Criteria

All three must match (configurable in Settings):

| Criterion  | Default       | Checks                                    |
|------------|---------------|-------------------------------------------|
| Location   | `Bangalore`   | Text includes "bangalore" or "bengaluru"  |
| Event Type | `In-Person`   | Not online/virtual/zoom                   |
| Cost       | `Free`        | Includes "free", "₹0", "no fee", etc.    |

---

## 🌐 Event Sources (Bookmark Scanning)

The extension scans **your Chrome bookmarks** that you select in the popup → Sources tab.

**Recommended sources to bookmark:**
- `https://www.meetup.com/cities/in/bangalore/`
- `https://www.townscript.com/events/bangalore`
- `https://in.bookmyshow.com/events/bangalore`
- `https://hasgeek.com/`
- `https://www.eventbrite.com/d/india--bangalore/`
- `https://gdg.community.dev/chapters/`
- Company websites with `/events` pages

---

## 🔐 Security

- **Passwords**: bcrypt with 12 salt rounds
- **Auth**: JWT tokens, 7-day expiry
- **Rate Limiting**: 20 req/15min on auth, 100 req/min on API
- **Helmet.js**: Security headers (HSTS, CSP, etc.)
- **CORS**: Restricted to extension origin + localhost
- **Offline Mode**: Local tokens prefixed `local_` work without DB

---

## 📋 Extension Permissions Explained

| Permission       | Why                                           |
|------------------|-----------------------------------------------|
| `tabs`           | Read URL to detect typos                      |
| `webNavigation`  | Intercept navigation before page loads        |
| `storage`        | Save user session, settings, scan results     |
| `notifications`  | Show match/typo alerts                        |
| `alarms`         | Schedule daily 8 AM scan                     |
| `bookmarks`      | Read your bookmarks as event sources          |
| `scripting`      | Inject content.js for SPA URL tracking        |
| `<all_urls>`     | Fetch HTML from event source websites         |

---

## 🏗️ Tech Stack

| Layer         | Technology                   |
|---------------|------------------------------|
| Extension     | Chrome MV3 (Vanilla JS, ES Modules) |
| Popup/Dashboard | HTML5, CSS3, Vanilla JS     |
| Backend       | Node.js 18, Express 4        |
| Database      | PostgreSQL 14+ (Cloud SQL ready) |
| Auth          | JWT + bcrypt                 |
| Local Storage | IndexedDB (IndexedDB via db.js) |
| Hosting       | GCP Cloud Run (recommended)  |

---

## 🚢 Deployment (GCP)

### Cloud SQL (PostgreSQL)
```bash
gcloud sql instances create myeventio-db \
  --database-version=POSTGRES_14 \
  --tier=db-f1-micro \
  --region=asia-south1
```

### Cloud Run (Backend)
```bash
# Build and push container
gcloud builds submit --tag gcr.io/YOUR_PROJECT/myeventio-backend

# Deploy
gcloud run deploy myeventio-backend \
  --image gcr.io/YOUR_PROJECT/myeventio-backend \
  --platform managed \
  --region asia-south1 \
  --allow-unauthenticated \
  --set-env-vars "DB_HOST=...,JWT_SECRET=..."
```

---

## 🗺️ MVP Roadmap

| Week   | Goal                                                    | Status |
|--------|---------------------------------------------------------|--------|
| Week 1 | Chrome Extension (typo detection + popup UI)            | ✅ Done |
| Week 1 | Backend API (auth + events + anomalies)                 | ✅ Done |
| Week 1 | Web Dashboard (SPA with all 4 pages)                    | ✅ Done |
| Week 1 | IndexedDB offline-first storage                         | ✅ Done |
| Week 2 | Daily bookmark scan + HTML event extraction             | ✅ Done |
| Week 2 | Rule-based filtering (Bangalore / Free / In-Person)     | ✅ Done |
| Week 2 | Chrome push notifications                               | ✅ Done |
| Week 2 | Background sync to PostgreSQL                           | ✅ Done |
| Week 3 | AI-based event extraction (OpenAI API)                  | 🔜 Next |
| Week 3 | Interest profiling / user preference learning           | 🔜 Next |
| Week 3 | Email notifications (SendGrid)                          | 🔜 Next |
| Week 4 | GCP deployment (Cloud Run + Cloud SQL)                  | 🔜 Next |

---

## 🐛 Troubleshooting

| Problem                          | Solution                                                     |
|----------------------------------|--------------------------------------------------------------|
| Extension won't load             | Check for JS errors in `chrome://extensions` → Service Worker |
| Popup shows auth screen always   | Clear `chrome.storage.local` via DevTools → Application      |
| Scan finds 0 events              | Add bookmarks in the Sources tab first                        |
| Backend 401 errors               | Token expired — log out and log back in                       |
| DB connection refused            | Check PostgreSQL is running and `.env` credentials are correct |
| Fonts not loading in popup       | Normal if offline — Inter falls back to system-ui             |

---

## 📄 License

MIT — Build freely, learn deeply.

---

*Built as a resume/startup-level project demonstrating Chrome Extension development, backend APIs, offline-first architecture, and intelligent automation.*
>>>>>>> 4a0f61a (new project)
