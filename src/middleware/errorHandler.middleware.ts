import { Request, Response, NextFunction } from 'express';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('ErrorHandler');

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  logger.error(
    {
      err: err.message,
      stack: err.stack,
      correlationId: req.correlationId,
      url: req.originalUrl,
      method: req.method,
    },
    'Unhandled request error'
  );

  const statusCode = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    error: err.name || 'Internal Server Error',
    message: isProd && statusCode === 500 ? 'An unexpected server error occurred' : err.message,
    correlationId: req.correlationId,
    ...(isProd ? {} : { stack: err.stack }),
  });
}
