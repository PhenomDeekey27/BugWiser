// Neon PostgreSQL connection pool.
//
// One pool per server process, cached on globalThis so Next.js hot reloads and
// route modules share it instead of opening a connection per request. Requests
// go to DATABASE_URL (Neon's pooled endpoint); migrations use the direct
// endpoint and do not go through this module.
//
// Type parsers are pinned to PostgREST's JSON behaviour so the values the rest
// of the app receives keep the shapes it already expects (ISO timestamp
// strings, numbers for bigint/numeric) rather than node-postgres defaults.

import pg from 'pg';

const { Pool, types } = pg;

// timestamptz / timestamp → ISO 8601 string (PostgREST returns strings).
types.setTypeParser(1184, (value) => (value === null ? value : new Date(value).toISOString()));
types.setTypeParser(1114, (value) =>
  value === null ? value : new Date(value.replace(' ', 'T') + 'Z').toISOString()
);
// bigint → number, matching JSON numbers for ids such as installation_id.
types.setTypeParser(20, (value) => (value === null ? value : Number(value)));
// numeric → number (plans/prices), matching PostgREST.
types.setTypeParser(1700, (value) => (value === null ? value : Number(value)));

export interface DbError {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

interface PoolCache {
  pool?: pg.Pool;
  key?: string;
}

const globalForDb = globalThis as typeof globalThis & { __bugwiserDb?: PoolCache };
const cache: PoolCache = (globalForDb.__bugwiserDb ??= {});

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Point it at the Neon PostgreSQL pooled connection string.');
  }
  return url;
}

/** Shared pool for application queries. */
export function getPool(): pg.Pool {
  const url = databaseUrl();
  if (cache.pool && cache.key === url) return cache.pool;

  const parsed = new URL(url);
  const pool = new Pool({
    connectionString: url,
    // Neon always requires TLS. sslmode in the URL is honoured by
    // pg-connection-string; supply an explicit default when it is absent.
    ssl: parsed.searchParams.has('sslmode') ? undefined : { rejectUnauthorized: false },
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'bugwiser-app',
  });

  // An idle client error must never take the process down.
  pool.on('error', (error) => {
    console.error('[db] idle client error:', error.message);
  });

  cache.pool = pool;
  cache.key = url;
  return pool;
}

export async function closePool(): Promise<void> {
  if (cache.pool) {
    await cache.pool.end();
    cache.pool = undefined;
    cache.key = undefined;
  }
}
