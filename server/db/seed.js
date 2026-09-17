// Seeds one demo account so the new dashboard (Profile/Character tabs) has real data to show
// without needing to register a fresh account first. Safe to re-run: uses ON CONFLICT DO NOTHING
// everywhere, so it never overwrites a real player's account or progress.
import crypto from 'crypto';
import { pool } from '../db.js';

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

async function main() {
  const username = 'demo';
  const password = 'demo1234';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  const userRes = await pool.query(
    `INSERT INTO users (username, password_salt, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, salt, hash]
  );

  let userId = userRes.rows[0]?.id;
  if (!userId) {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    userId = existing.rows[0].id;
  }

  await pool.query(
    `INSERT INTO player_stats (user_id, kills, deaths, matches_played)
     VALUES ($1, 12, 7, 5)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  await pool.query(
    `INSERT INTO player_customization (user_id, primary_color, secondary_color)
     VALUES ($1, '#e8c65a', '#3d7dca')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  console.log(`Seeded demo account: username="${username}" password="${password}"`);
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
