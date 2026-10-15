import pg from 'pg';
import { env } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('Database');

const { Pool } = pg;

let pool: pg.Pool = new Pool({
  connectionString: env.DATABASE_URL,
  min: env.DATABASE_POOL_MIN,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database client error on idle connection');
});

export function getPool(): pg.Pool {
  return pool;
}

export function setCustomPool(customPool: pg.Pool): void {
  pool = customPool;
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    logger.trace({ query: text, duration, rows: res.rowCount }, 'Database query executed');
    return res;
  } catch (err: any) {
    logger.error({ query: text, err: err.message }, 'Database query error');
    throw err;
  }
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Transaction rolled back due to error');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const res = await pool.query('SELECT 1 as health');
    return res.rows.length > 0 && res.rows[0].health === 1;
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Database health check failed');
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  logger.info('Closing database connection pool');
  await pool.end();
}
