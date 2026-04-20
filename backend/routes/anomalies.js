/**
 * routes/anomalies.js — URL Anomaly Sync & Query
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const authMW   = require('../middleware/auth');

// ── POST /api/anomalies/sync ──────────────────────────
router.post('/sync', authMW, async (req, res) => {
  try {
    const { anomalies } = req.body;
    const userId = req.user.user_id;

    if (!Array.isArray(anomalies) || anomalies.length === 0) {
      return res.status(400).json({ error: 'anomalies must be a non-empty array' });
    }

    const pool = global.dbPool;
    let inserted = 0;
    let skipped  = 0;

    for (const a of anomalies) {
      try {
        await pool.query(
          `INSERT INTO url_anomalies
             (user_id, original_url, corrected_url, timestamp, site_name, status)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            userId,
            a.original_url,
            a.corrected_url,
            a.timestamp ? new Date(a.timestamp).toISOString() : new Date().toISOString(),
            a.site_name  || null,
            a.status     || 'synced',
          ]
        );
        inserted++;
      } catch (rowErr) {
        console.error('[anomalies/sync] Row error:', rowErr.message);
        skipped++;
      }
    }

    res.json({ success: true, inserted, skipped });
  } catch (err) {
    console.error('[anomalies/sync] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/anomalies ────────────────────────────────
router.get('/', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;
    const { limit = 100, offset = 0 } = req.query;

    const result = await pool.query(
      `SELECT * FROM url_anomalies
       WHERE user_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    res.json({ anomalies: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[anomalies/get] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/anomalies/:id ─────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;
    await pool.query(
      'DELETE FROM url_anomalies WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
