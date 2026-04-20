/**
 * routes/events.js — Event Sync & Query
 */

'use strict';

const express  = require('express');
const router   = express.Router();
const authMW   = require('../middleware/auth');

// ── POST /api/events/sync ─────────────────────────────
// Called by extension to sync locally-stored events to cloud DB.
router.post('/sync', authMW, async (req, res) => {
  try {
    const { events } = req.body;
    const userId = req.user.user_id;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'events must be a non-empty array' });
    }

    const pool = global.dbPool;
    let inserted = 0;
    let skipped  = 0;

    for (const evt of events) {
      try {
        // Upsert — skip duplicates gracefully
        const result = await pool.query(
          `INSERT INTO events
             (user_id, title, date, location, event_type, cost,
              source_url, source_name, scraped_at, matched_criteria, notified)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (user_id, title, COALESCE(date,'1970-01-01'::date), source_url)
           DO NOTHING
           RETURNING id`,
          [
            userId,
            evt.title        || 'Untitled',
            evt.date         || null,
            evt.location     || null,
            evt.event_type   || 'Unknown',
            evt.cost         || 'Unknown',
            evt.source_url,
            evt.source_name  || null,
            evt.scraped_at   || new Date().toISOString(),
            evt.matched_criteria || false,
            evt.notified     || false,
          ]
        );
        if (result.rows.length > 0) inserted++;
        else skipped++;
      } catch (rowErr) {
        console.error('[events/sync] Row error:', rowErr.message);
        skipped++;
      }
    }

    res.json({ success: true, inserted, skipped });
  } catch (err) {
    console.error('[events/sync] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/events ───────────────────────────────────
// Get all events for authenticated user.
router.get('/', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;

    const { matched, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM events WHERE user_id = $1';
    const params = [userId];

    if (matched === 'true') {
      query += ' AND matched_criteria = true';
    }

    query += ' ORDER BY date ASC NULLS LAST LIMIT $2 OFFSET $3';
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);
    res.json({ events: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('[events/get] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /api/events/:id ────────────────────────────
router.delete('/:id', authMW, async (req, res) => {
  try {
    const pool   = global.dbPool;
    const userId = req.user.user_id;
    await pool.query(
      'DELETE FROM events WHERE id = $1 AND user_id = $2',
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
