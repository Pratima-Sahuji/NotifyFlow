import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../database/connection.js';
import { checkRedisHealth } from '../queue/bullmq.client.js';
import { getQueueMetrics } from '../queue/notification.queue.js';
import { wsManager } from '../delivery/websocket/websocket.manager.js';

const router = Router();

/**
 * @openapi
 * /health/live:
 *   get:
 *     summary: Kubernetes / Docker liveness probe
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Process is running
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /health/ready:
 *   get:
 *     summary: Readiness probe checking PostgreSQL and Redis connectivity
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: All core infrastructure dependencies are healthy
 *       503:
 *         description: One or more dependencies are degraded
 */
router.get('/ready', async (req: Request, res: Response) => {
  const [dbHealthy, redisHealthy] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const allHealthy = dbHealthy && redisHealthy;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'degraded',
    components: {
      database: dbHealthy ? 'up' : 'down',
      redis: redisHealthy ? 'up' : 'down',
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /health/metrics:
 *   get:
 *     summary: Queue health and operational metrics
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Real-time queue and WebSocket operational metrics
 */
router.get('/metrics', async (req: Request, res: Response) => {
  const queueMetrics = await getQueueMetrics();
  const wsStats = wsManager.getOnlineStats();

  res.status(200).json({
    queue: queueMetrics,
    websockets: wsStats,
    system: {
      uptimeSeconds: Math.floor(process.uptime()),
      memoryUsageMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      nodeVersion: process.version,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
