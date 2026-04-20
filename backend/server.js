/**
 * server.js — MyEvent.io Express API Server
 */

'use strict';

require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const { Pool }    = require('pg');

const authRoutes      = require('./routes/auth');
const eventsRoutes    = require('./routes/events');
const anomalyRoutes   = require('./routes/anomalies');
const urlLogRoutes    = require('./routes/url-log');

// ── DB Pool ───────────────────────────────────────────
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'myeventio',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || '',
  max:      20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client', err);
});

// Make pool available globally for routes
global.dbPool = pool;

// ── App ───────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    'chrome-extension://*',
    'https://myevent.io',
    'http://localhost:3000',
    'http://localhost:8080',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '5mb' }));

// ── Rate Limiting ─────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  message: { error: 'Rate limit exceeded.' },
});

// ── Routes ────────────────────────────────────────────
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/events',    apiLimiter, eventsRoutes);
app.use('/api/anomalies', apiLimiter, anomalyRoutes);
app.use('/api/url-log',   apiLimiter, urlLogRoutes);

// ── Dashboard data endpoint ───────────────────────────
app.get('/api/dashboard/:uid', require('./middleware/auth'), async (req, res) => {
  try {
    const { uid } = req.params;

    // Verify requesting user matches token
    if (req.user.user_id !== uid) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [eventsResult, anomaliesResult, interestsResult] = await Promise.all([
      pool.query(
        `SELECT * FROM events WHERE user_id = $1 ORDER BY date ASC NULLS LAST`,
        [uid]
      ),
      pool.query(
        `SELECT * FROM url_anomalies WHERE user_id = $1 ORDER BY timestamp DESC`,
        [uid]
      ),
      pool.query(
        `SELECT domain, COUNT(*) AS visits, MAX(score) AS max_score
         FROM url_activity
         WHERE user_id = $1 AND domain IS NOT NULL
         GROUP BY domain ORDER BY visits DESC LIMIT 10`,
        [uid]
      ).catch(() => ({ rows: [] })), // Graceful if table not migrated yet
    ]);

    res.json({
      events:     eventsResult.rows,
      anomalies:  anomaliesResult.rows,
      interests:  interestsResult.rows,
      stats: {
        total_events:    eventsResult.rows.length,
        matched_events:  eventsResult.rows.filter((e) => e.matched_criteria).length,
        total_anomalies: anomaliesResult.rows.length,
        sources:         0, // populated by extension stats
      },
    });
  } catch (err) {
    console.error('[dashboard] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Health check ──────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' });
  }
});

// ── 404 handler ───────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[MyEvent.io] Server running on http://localhost:${PORT}`);
});

module.exports = app;
