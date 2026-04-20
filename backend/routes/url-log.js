/**
 * routes/url-log.js — URL Activity Log
 *
 * Stores scored URL visits from the extension's interest profiler.
 * Drives the "Suggested Sources" feature on the dashboard.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const authMW  = require('../middleware/auth');

// ── POST /api/url-log ─────────────────────────────────
// Called by background.js whenever a high-score URL is visited.
router.post('/', authMW, async (req, res) => {
  try {
    const { url, title, score, timestamp } = req.body;
    const userId = req.user.user_id;

    if (!url) return res.status(400).json({ error: 'url is required' });

    const pool = global.dbPool;
    let domain = null;
    try { domain = new URL(url).hostname; } catch { /* ignore */ }

    await pool.query(
      `INSERT INTO url_activity (user_id, url, title, domain, score, visited_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [
        userId,
        url,
        title || null,
        domain,
        score || 0,
        timestamp ? new Date(timestamp).toISOString() : new Date().toISOString(),
      ]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[url-log/post] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/url-log ──────────────────────────────────
// Returns interest profile — top domains by visit count.
router.get('/', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;

    const [topDomains, recent] = await Promise.all([
      pool.query(
        `SELECT domain,
                COUNT(*)       AS visits,
                MAX(score)     AS max_score,
                MAX(visited_at) AS last_visit
         FROM url_activity
         WHERE user_id = $1 AND domain IS NOT NULL
         GROUP BY domain
         ORDER BY visits DESC, max_score DESC
         LIMIT 20`,
        [userId]
      ),
      pool.query(
        `SELECT url, title, domain, score, visited_at
         FROM url_activity
         WHERE user_id = $1
         ORDER BY visited_at DESC
         LIMIT 50`,
        [userId]
      ),
    ]);

    // Build suggested sources: domains with score >= 15
    const suggested = topDomains.rows.filter((d) => d.max_score >= 15);

    res.json({
      topDomains:       topDomains.rows,
      recentActivity:   recent.rows,
      suggestedSources: suggested,
    });
  } catch (err) {
    console.error('[url-log/get] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/url-log ───────────────────────────────
// Clear activity log for privacy.
router.delete('/', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;
    await pool.query('DELETE FROM url_activity WHERE user_id = $1', [userId]);
    res.json({ success: true, message: 'Activity log cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
