// Applies schema.sql against the configured Postgres database. Idempotent — every statement in
// schema.sql is CREATE ... IF NOT EXISTS, so running this multiple times is harmless.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migration applied: users, player_stats, player_customization tables ready.');
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
