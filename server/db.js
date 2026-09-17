import pg from 'pg';

const { Pool } = pg;

// Local dev Postgres — a dedicated 'wreckveil' role/database inside the already-running
// antiszn_postgres docker container (see server/db/schema.sql for the tables). Overridable via
// env vars so this doesn't have to change if the container/credentials ever move.
export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || 'wreckveil',
  password: process.env.PGPASSWORD || 'wreckveil_dev',
  database: process.env.PGDATABASE || 'wreckveil',
});

export function query(text, params) {
  return pool.query(text, params);
}
