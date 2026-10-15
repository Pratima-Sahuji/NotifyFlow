import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { createChildLogger } from '../../config/logger.js';
import { wsManager, AuthenticatedWebSocket } from './websocket.manager.js';
import { IDeliveryChannel, NotificationPayload, DeliveryResult } from '../channels/channel.interface.js';

const logger = createChildLogger('WebSocketServer');

export function initWebSocketServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
    ws.isAlive = true;

    // Check if token was provided in query string ?token=...
    const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const queryToken = url.searchParams.get('token');
    const deviceId = url.searchParams.get('deviceId') || 'default';

    if (queryToken) {
      try {
        const decoded = jwt.verify(queryToken, env.JWT_SECRET) as { sub?: string; userId?: string; id?: string };
        const userId = decoded.sub || decoded.userId || decoded.id;
        if (userId) {
          wsManager.registerSocket(ws, String(userId), deviceId);
          ws.send(JSON.stringify({ type: 'auth_success', userId }));
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'WebSocket query token auth failed');
        ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid_token' }));
      }
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'auth') {
          const token = msg.accessToken || msg.token;
          if (!token) {
            ws.send(JSON.stringify({ type: 'auth_error', reason: 'missing_token' }));
            return;
          }

          try {
            const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; userId?: string; id?: string };
            const userId = decoded.sub || decoded.userId || decoded.id;
            if (!userId) throw new Error('Token missing user identifier');

            wsManager.registerSocket(ws, String(userId), msg.deviceId || 'default');
            ws.send(JSON.stringify({ type: 'auth_success', userId }));
          } catch (jwtErr: any) {
            logger.warn({ err: jwtErr.message }, 'WebSocket message auth failed');
            ws.send(JSON.stringify({ type: 'auth_error', reason: jwtErr.message }));
          }
        } else if (msg.type === 'ping') {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (parseErr) {
        logger.debug('Non-JSON WebSocket message received');
      }
    });

    ws.on('close', () => {
      wsManager.removeSocket(ws);
    });

    ws.on('error', (err) => {
      logger.warn({ err: err.message }, 'WebSocket client error');
      wsManager.removeSocket(ws);
    });
  });

  logger.info('WebSocket server initialized on /ws');
  return wss;
}

export class WebSocketDeliveryChannel implements IDeliveryChannel {
  public name: 'websocket' = 'websocket';

  public async deliver(notification: NotificationPayload): Promise<DeliveryResult[]> {
    const isOnline = wsManager.isUserOnline(notification.userId);

    const payload = {
      type: 'notification',
      notification: {
        id: notification.notificationId,
        eventId: notification.eventId,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        priority: notification.priority,
        timestamp: new Date().toISOString(),
      },
    };

    const sent = wsManager.sendToUser(notification.userId, payload);

    return [
      {
        channel: 'websocket',
        success: sent || isOnline,
        recipientId: notification.userId,
        error: !sent && !isOnline ? 'User has no active WebSocket connections' : undefined,
      },
    ];
  }
}

export const wsDeliveryChannel = new WebSocketDeliveryChannel();
