import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { correlationMiddleware } from './middleware/correlation.middleware.js';
import { apiRateLimiter } from './middleware/rateLimiter.middleware.js';
import { errorHandler } from './middleware/errorHandler.middleware.js';
import { swaggerSpec } from './docs/swagger.js';

// Route imports
import eventsRoutes from './modules/events/events.routes.js';
import notificationsRoutes from './modules/notifications/notifications.routes.js';
import devicesRoutes from './modules/devices/devices.routes.js';
import preferencesRoutes from './modules/preferences/preferences.routes.js';
import healthRoutes from './observability/health.routes.js';

export function createApp(): Express {
  const app = express();

  // Security & Middleware
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(correlationMiddleware);

  // Health & Readiness Probes
  app.use('/health', healthRoutes);

  // OpenAPI Swagger Documentation
  if (env.ENABLE_SWAGGER) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
    app.get('/docs/json', (req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });
  }

  // API v1 Routes
  app.use('/api/v1/events', apiRateLimiter, eventsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/devices', devicesRoutes);
  app.use('/api/v1/preferences', preferencesRoutes);

  // 404 Handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      error: 'Not Found',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      correlationId: (req as any).correlationId,
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
