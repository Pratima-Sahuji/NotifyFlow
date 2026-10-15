import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPool, withTransaction } from './connection.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('Migrator');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  logger.info({ migrationsDir }, 'Starting database migrations...');

  if (!fs.existsSync(migrationsDir)) {
    logger.warn({ migrationsDir }, 'Migrations directory does not exist, skipping.');
    return;
  }

  const pool = getPool();

  // Create migrations log table if not present
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const appliedRows = await pool.query('SELECT version FROM schema_migrations');
  const appliedVersions = new Set(appliedRows.rows.map((r: { version: string }) => r.version));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedVersions.has(file)) {
      logger.debug({ file }, 'Migration already applied');
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    logger.info({ file }, 'Applying migration');

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    });

    logger.info({ file }, 'Successfully applied migration');
  }

  logger.info('All database migrations completed successfully.');
}

if (process.argv[1] && process.argv[1].endsWith('migrator.ts')) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration runner failed');
      process.exit(1);
    });
}
