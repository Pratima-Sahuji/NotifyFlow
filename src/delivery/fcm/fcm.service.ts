import { GoogleAuth } from 'google-auth-library';
import { env } from '../../config/env.js';
import { createChildLogger } from '../../config/logger.js';
import { query } from '../../database/connection.js';
import { IDeliveryChannel, NotificationPayload, DeliveryResult } from '../channels/channel.interface.js';

const logger = createChildLogger('FcmService');

export interface DeviceTokenRow {
  token: string;
  platform: string;
}

export class FcmDeliveryChannel implements IDeliveryChannel {
  public name: 'fcm' = 'fcm';
  private googleAuth: GoogleAuth | null = null;
  private projectId: string | null = null;
  private isConfigured = false;

  constructor() {
    this.initCredentials();
  }

  private initCredentials(): void {
    if (env.USE_MOCK_FCM) {
      logger.info('USE_MOCK_FCM is enabled; FCM service will operate in mock mode');
      return;
    }

    try {
      if (env.FIREBASE_SERVICE_ACCOUNT) {
        const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
        this.projectId = sa.project_id;
        this.googleAuth = new GoogleAuth({
          credentials: {
            client_email: sa.client_email,
            private_key: (sa.private_key || '').replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        this.isConfigured = true;
        logger.info({ projectId: this.projectId }, 'FCM credentials initialized from FIREBASE_SERVICE_ACCOUNT');
      } else if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
        this.projectId = env.FIREBASE_PROJECT_ID;
        this.googleAuth = new GoogleAuth({
          credentials: {
            client_email: env.FIREBASE_CLIENT_EMAIL,
            private_key: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
          },
          scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
        });
        this.isConfigured = true;
        logger.info({ projectId: this.projectId }, 'FCM credentials initialized from individual env variables');
      } else {
        logger.warn('No FCM credentials provided; running in mock delivery mode');
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to parse Firebase credentials; defaulting to mock mode');
    }
  }

  public async getAccessToken(): Promise<string> {
    if (!this.googleAuth) {
      throw new Error('GoogleAuth not configured');
    }
    const client = await this.googleAuth.getClient();
    const tokenResponse = await client.getAccessToken();
    if (!tokenResponse.token) {
      throw new Error('Failed to obtain Google OAuth2 access token for FCM');
    }
    return tokenResponse.token;
  }

  public async deliver(notification: NotificationPayload): Promise<DeliveryResult[]> {
    // 1. Fetch user device tokens
    const tokensRes = await query<DeviceTokenRow>(
      `SELECT token, platform
       FROM device_tokens
       WHERE user_id = $1 AND is_active = TRUE`,
      [notification.userId]
    );

    if (tokensRes.rows.length === 0) {
      return [
        {
          channel: 'fcm',
          success: false,
          recipientId: notification.userId,
          error: 'No active device tokens found for recipient',
          isRetryable: false,
        },
      ];
    }

    const deviceTokens = tokensRes.rows;

    // Stringify data payload for FCM HTTP v1 specification
    const stringifiedData: Record<string, string> = {
      notificationId: String(notification.notificationId),
      eventId: String(notification.eventId),
      type: String(notification.type),
      title: String(notification.title),
      body: String(notification.body),
      priority: String(notification.priority),
    };

    if (notification.data && typeof notification.data === 'object') {
      for (const [k, v] of Object.entries(notification.data)) {
        stringifiedData[k] = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
      }
    }

    const results: DeliveryResult[] = [];
    const tokensToPrune: string[] = [];

    // Deliver to each token
    for (const dt of deviceTokens) {
      // Mock mode delivery
      if (!this.isConfigured || env.USE_MOCK_FCM) {
        if (dt.token.includes('invalid') || dt.token.includes('unregistered')) {
          tokensToPrune.push(dt.token);
          results.push({
            channel: 'fcm',
            success: false,
            recipientId: notification.userId,
            deviceToken: dt.token,
            error: 'UNREGISTERED',
            isRetryable: false,
          });
        } else {
          results.push({
            channel: 'fcm',
            success: true,
            recipientId: notification.userId,
            deviceToken: dt.token,
          });
        }
        continue;
      }

      // Real FCM HTTP v1 Delivery
      try {
        const accessToken = await this.getAccessToken();
        const url = `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`;

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: dt.token,
              notification: {
                title: notification.title,
                body: notification.body,
              },
              data: stringifiedData,
              android: {
                priority: notification.priority === 'urgent' ? 'high' : 'normal',
                notification: {
                  channel_id: 'notifyflow_alerts',
                  sound: notification.priority === 'urgent' ? 'alert_sound' : 'default',
                  default_sound: true,
                },
              },
            },
          }),
        });

        const resData = (await response.json()) as any;

        if (response.ok) {
          results.push({
            channel: 'fcm',
            success: true,
            recipientId: notification.userId,
            deviceToken: dt.token,
          });
        } else {
          const errorCode = resData?.error?.details?.[0]?.errorCode || resData?.error?.status;
          const isDeadToken =
            errorCode === 'UNREGISTERED' ||
            errorCode === 'NOT_FOUND' ||
            errorCode === 'INVALID_ARGUMENT' ||
            resData?.error?.message?.includes('Requested entity was not found');

          if (isDeadToken) {
            tokensToPrune.push(dt.token);
          }

          const isRateLimit = response.status === 429 || response.status >= 500;

          results.push({
            channel: 'fcm',
            success: false,
            recipientId: notification.userId,
            deviceToken: dt.token,
            error: resData?.error?.message || errorCode || 'FCM error',
            isRetryable: isRateLimit,
          });
        }
      } catch (sendErr: any) {
        logger.error({ err: sendErr.message, token: dt.token }, 'FCM delivery exception');
        results.push({
          channel: 'fcm',
          success: false,
          recipientId: notification.userId,
          deviceToken: dt.token,
          error: sendErr.message,
          isRetryable: true,
        });
      }
    }

    // Prune dead tokens automatically
    if (tokensToPrune.length > 0) {
      await this.pruneDeadTokens(tokensToPrune);
    }

    return results;
  }

  public async pruneDeadTokens(tokens: string[]): Promise<void> {
    try {
      logger.info({ count: tokens.length }, 'Pruning dead / unregistered FCM tokens from database');
      await query(
        `UPDATE device_tokens
         SET is_active = FALSE, updated_at = NOW()
         WHERE token = ANY($1::text[])`,
        [tokens]
      );
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to prune dead device tokens');
    }
  }
}

export const fcmDeliveryChannel = new FcmDeliveryChannel();
