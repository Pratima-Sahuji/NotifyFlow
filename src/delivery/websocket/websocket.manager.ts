import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { createChildLogger } from '../../config/logger.js';
import { getRedisClient, isRedisConnected } from '../../queue/bullmq.client.js';
import { Redis } from 'ioredis';

const logger = createChildLogger('WebSocketManager');

export interface AuthenticatedWebSocket extends WebSocket {
  isAlive: boolean;
  userId?: string;
  deviceId?: string;
  authenticatedAt?: Date;
}

export const WS_REDIS_CHANNEL = 'notifyflow:ws:broadcast';

export class WebSocketManager {
  private userSockets = new Map<string, Set<AuthenticatedWebSocket>>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private redisSub: Redis | null = null;

  constructor() {
    this.setupRedisSubscriber();
    this.startHeartbeat();
  }

  private setupRedisSubscriber(): void {
    try {
      if (isRedisConnected()) {
        this.redisSub = getRedisClient().duplicate();
        this.redisSub.subscribe(WS_REDIS_CHANNEL, (err) => {
          if (err) {
            logger.warn({ err: err.message }, 'Failed to subscribe to WebSocket Redis channel');
          } else {
            logger.info('Subscribed to WebSocket cross-instance broadcast channel');
          }
        });

        this.redisSub.on('message', (channel, message) => {
          if (channel === WS_REDIS_CHANNEL) {
            try {
              const { userId, payload } = JSON.parse(message);
              this.sendLocal(userId, payload);
            } catch (parseErr: any) {
              logger.warn({ err: parseErr.message }, 'Failed to parse cross-instance WS message');
            }
          }
        });
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Could not initialize Redis subscriber for WebSockets');
    }
  }

  public registerSocket(ws: AuthenticatedWebSocket, userId: string, deviceId = 'default'): void {
    ws.userId = userId;
    ws.deviceId = deviceId;
    ws.isAlive = true;
    ws.authenticatedAt = new Date();

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(ws);

    logger.info({ userId, deviceId, totalDevices: this.userSockets.get(userId)!.size }, 'WebSocket client registered');
  }

  public removeSocket(ws: AuthenticatedWebSocket): void {
    if (ws.userId && this.userSockets.has(ws.userId)) {
      const sockets = this.userSockets.get(ws.userId)!;
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.userSockets.delete(ws.userId);
      }
      logger.info({ userId: ws.userId }, 'WebSocket client unregistered');
    }
  }

  public sendToUser(userId: string, payload: Record<string, any>): boolean {
    const deliveredLocally = this.sendLocal(userId, payload);

    // Broadcast to Redis for other cluster instances
    if (isRedisConnected()) {
      try {
        const client = getRedisClient();
        client.publish(WS_REDIS_CHANNEL, JSON.stringify({ userId, payload })).catch(() => {});
      } catch (_) {}
    }

    return deliveredLocally;
  }

  private sendLocal(userId: string, payload: Record<string, any>): boolean {
    const sockets = this.userSockets.get(userId);
    if (!sockets || sockets.size === 0) {
      return false;
    }

    const json = JSON.stringify(payload);
    let sentCount = 0;

    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(json);
          sentCount++;
        } catch (err: any) {
          logger.warn({ userId, err: err.message }, 'Failed to send message to socket');
        }
      }
    }

    return sentCount > 0;
  }

  public isUserOnline(userId: string): boolean {
    return this.userSockets.has(userId) && this.userSockets.get(userId)!.size > 0;
  }

  public getOnlineStats(): { onlineUsers: number; totalSockets: number } {
    let totalSockets = 0;
    for (const sockets of this.userSockets.values()) {
      totalSockets += sockets.size;
    }
    return {
      onlineUsers: this.userSockets.size,
      totalSockets,
    };
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [userId, sockets] of this.userSockets.entries()) {
        for (const ws of sockets) {
          if (!ws.isAlive) {
            logger.debug({ userId }, 'Terminating unresponsive WebSocket connection');
            ws.terminate();
            sockets.delete(ws);
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
        }
      }
    }, 30000);
  }

  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.redisSub) {
      this.redisSub.disconnect();
      this.redisSub = null;
    }
    for (const sockets of this.userSockets.values()) {
      for (const ws of sockets) {
        ws.close(1001, 'Server shutting down');
      }
    }
    this.userSockets.clear();
  }
}

export const wsManager = new WebSocketManager();
