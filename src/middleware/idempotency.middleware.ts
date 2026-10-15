import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { query } from '../database/connection.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('IdempotencyMiddleware');

export function idempotency(req: Request, res: Response, next: NextFunction): void {
  const idempotencyKey = req.headers['idempotency-key'] as string;

  if (!idempotencyKey) {
    next();
    return;
  }

  // Calculate canonical SHA-256 hash of URL + Body
  const payloadString = JSON.stringify(req.body || {});
  const requestHash = crypto
    .createHash('sha256')
    .update(`${req.method}:${req.originalUrl}:${payloadString}`)
    .digest('hex');

  (async () => {
    try {
      // 1. Check if key already exists
      const checkRes = await query<{
        key: string;
        request_hash: string;
        status: string;
        status_code: number;
        response_body: any;
        expires_at: Date;
      }>(
        `SELECT key, request_hash, status, status_code, response_body, expires_at
         FROM idempotency_keys
         WHERE key = $1`,
        [idempotencyKey]
      );

      if (checkRes.rows.length > 0) {
        const existing = checkRes.rows[0];

        // Verify request payload matches original submission
        if (existing.request_hash !== requestHash) {
          res.status(422).json({
            error: 'Unprocessable Entity',
            message: 'Idempotency key was previously used with a different request payload',
            correlationId: req.correlationId,
          });
          return;
        }

        if (existing.status === 'in_progress') {
          res.status(409).json({
            error: 'Conflict',
            message: 'A request with this idempotency key is currently being processed',
            correlationId: req.correlationId,
          });
          return;
        }

        if (existing.status === 'completed') {
          res.setHeader('X-Cache-Lookup', 'HIT-IDEMPOTENT');
          res.status(existing.status_code).json(existing.response_body);
          return;
        }
      }

      // 2. Reserve the key as in_progress (expires in 24 hours)
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await query(
        `INSERT INTO idempotency_keys (key, request_hash, status, expires_at)
         VALUES ($1, $2, 'in_progress', $3)
         ON CONFLICT (key) DO NOTHING`,
        [idempotencyKey, requestHash, expiresAt]
      );

      // 3. Intercept res.json / res.send to save the completed response
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        // Asynchronously mark key as completed
        query(
          `UPDATE idempotency_keys
           SET status = 'completed', status_code = $1, response_body = $2
           WHERE key = $3`,
          [res.statusCode, JSON.stringify(body), idempotencyKey]
        ).catch((err) => {
          logger.error({ err: err.message, idempotencyKey }, 'Failed to persist completed idempotency record');
        });

        return originalJson(body);
      };

      next();
    } catch (err: any) {
      logger.error({ err: err.message, idempotencyKey }, 'Error evaluating idempotency key');
      next(err);
    }
  })();
}
