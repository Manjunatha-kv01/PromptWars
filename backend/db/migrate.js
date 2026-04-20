/**
 * db/migrate.js — Run this to initialize the PostgreSQL schema
 * Usage: node db/migrate.js
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT  || '5432'),
  database: process.env.DB_NAME     || 'myeventio',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASS     || '',
});

async function migrate() {
  console.log('🔧  Running MyEvent.io database migration…');

  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    await pool.query(sql);
    console.log('✅  Schema applied successfully.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
