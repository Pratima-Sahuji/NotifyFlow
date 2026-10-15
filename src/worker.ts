import { env } from './config/env.js';
import { createChildLogger } from './config/logger.js';
import { notificationWorker } from './workers/notification.worker.js';
import { closeDatabase } from './database/connection.js';
import { closeRedis } from './queue/bullmq.client.js';
import { closeNotificationQueue } from './queue/notification.queue.js';

const logger = createChildLogger('WorkerProcess');

async function startWorker() {
  logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Starting NotifyFlow Notification Worker Process...');

  notificationWorker.start();

  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Graceful worker shutdown initiated, draining active jobs...');

    try {
      await notificationWorker.close();
      await closeNotificationQueue();
      await closeRedis();
      await closeDatabase();
      logger.info('Notification worker shutdown completed cleanly');
      process.exit(0);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error during worker shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startWorker().catch((err) => {
  logger.error({ err }, 'Fatal error during worker process startup');
  process.exit(1);
});
