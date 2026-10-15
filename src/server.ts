import http from 'http';
import { app } from './app.js';
import { env } from './config/env.js';
import { createChildLogger } from './config/logger.js';
import { runMigrations } from './database/migrator.js';
import { closeDatabase, checkDatabaseHealth } from './database/connection.js';
import { closeRedis, checkRedisHealth } from './queue/bullmq.client.js';
import { closeNotificationQueue } from './queue/notification.queue.js';
import { outboxRelayer } from './queue/outbox.relayer.js';
import { initWebSocketServer } from './delivery/websocket/websocket.server.js';
import { wsManager } from './delivery/websocket/websocket.manager.js';

const logger = createChildLogger('Server');

async function startServer() {
  logger.info({ nodeEnv: env.NODE_ENV, port: env.PORT }, 'Initializing NotifyFlow API Server...');

  // 1. Run database migrations if DB is accessible
  try {
    const isDbUp = await checkDatabaseHealth();
    if (isDbUp) {
      await runMigrations();
    } else {
      logger.warn('PostgreSQL not accessible on startup; skipping automatic migrations');
    }
  } catch (migErr: any) {
    logger.warn({ err: migErr.message }, 'Database migration attempt warning');
  }

  // 2. Check Redis connectivity
  try {
    const isRedisUp = await checkRedisHealth();
    if (!isRedisUp) {
      logger.warn('Redis not currently accessible. Outbox Pattern will buffer all events durably in PostgreSQL.');
    }
  } catch (redisErr: any) {
    logger.warn({ err: redisErr.message }, 'Redis initial ping warning');
  }

  // 3. Start Outbox Relayer background worker
  outboxRelayer.start();

  // 4. Create HTTP Server
  const server = http.createServer(app);

  // 5. Initialize WebSocket Server attached to the HTTP server
  const wss = initWebSocketServer(server);

  server.listen(env.PORT, () => {
    logger.info(`?? NotifyFlow API Server running on http://localhost:${env.PORT}`);
    logger.info(`?? WebSocket Server active on ws://localhost:${env.PORT}/ws`);
    if (env.ENABLE_SWAGGER) {
      logger.info(`?? Interactive Swagger Documentation at http://localhost:${env.PORT}/docs`);
    }
  });

  // Graceful Shutdown
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated...');

    outboxRelayer.stop();
    wsManager.close();

    server.close(async () => {
      logger.info('HTTP server closed');
      try {
        await closeNotificationQueue();
        await closeRedis();
        await closeDatabase();
        logger.info('All infrastructure connections closed cleanly');
        process.exit(0);
      } catch (err: any) {
        logger.error({ err: err.message }, 'Error during graceful shutdown cleanup');
        process.exit(1);
      }
    });

    // Force exit if graceful cleanup exceeds 10s
    setTimeout(() => {
      logger.error('Shutdown timed out after 10s; forcing exit');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  logger.error({ err }, 'Fatal error during server startup');
  process.exit(1);
});
