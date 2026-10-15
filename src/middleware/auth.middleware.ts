import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('AuthMiddleware');

export interface AuthUser {
  userId: string;
  role?: string;
  email?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      correlationId?: string;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing Authorization header',
      correlationId: req.correlationId,
    });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Empty Bearer token',
      correlationId: req.correlationId,
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as any;
    const userId = decoded.sub || decoded.userId || decoded.id;

    if (!userId) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token does not contain user identification',
        correlationId: req.correlationId,
      });
      return;
    }

    req.user = {
      userId: String(userId),
      role: decoded.role || 'user',
      email: decoded.email,
    };

    next();
  } catch (err: any) {
    logger.debug({ err: err.message }, 'JWT verification failed');
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired JWT token',
      correlationId: req.correlationId,
    });
  }
}

export function generateToken(payload: { userId: string; role?: string; email?: string }): string {
  return jwt.sign(
    {
      sub: payload.userId,
      userId: payload.userId,
      role: payload.role || 'user',
      email: payload.email,
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any }
  );
}
