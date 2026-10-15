import { Worker, Job } from 'bullmq';
import { env } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';
import { getRedisClient } from '../queue/bullmq.client.js';
import { NOTIFICATION_QUEUE_NAME, NotificationJobPayload } from '../queue/notification.queue.js';
import { wsDeliveryChannel } from '../delivery/websocket/websocket.server.js';
import { fcmDeliveryChannel } from '../delivery/fcm/fcm.service.js';
import { IDeliveryChannel, DeliveryResult } from '../delivery/channels/channel.interface.js';
import { query, withTransaction } from '../database/connection.js';

const logger = createChildLogger('NotificationWorker');

export class NotificationWorker {
  private worker: Worker<NotificationJobPayload> | null = null;
  private channels: Map<string, IDeliveryChannel> = new Map();

  constructor() {
    this.registerChannel(wsDeliveryChannel);
    this.registerChannel(fcmDeliveryChannel);
  }

  public registerChannel(channel: IDeliveryChannel): void {
    this.channels.set(channel.name, channel);
  }

  public start(): Worker<NotificationJobPayload> {
    if (this.worker) return this.worker;

    const connection = getRedisClient();

    this.worker = new Worker<NotificationJobPayload>(
      NOTIFICATION_QUEUE_NAME,
      async (job: Job<NotificationJobPayload>) => {
        return this.processJob(job);
      },
      {
        connection,
        concurrency: env.WORKER_CONCURRENCY,
        limiter: {
          max: 1000,
          duration: 1000, // 1000 jobs / sec throttle limit
        },
      }
    );

    this.worker.on('completed', (job: Job) => {
      logger.info({ jobId: job.id, notificationId: job.data.notificationId }, 'Job processed successfully');
    });

    this.worker.on('failed', (job: Job | undefined, err: Error) => {
      logger.error(
        { jobId: job?.id, notificationId: job?.data?.notificationId, attemptsMade: job?.attemptsMade, err: err.message },
        'Job processing failed'
      );
    });

    this.worker.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'BullMQ Worker error');
    });

    logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'Notification Worker started');
    return this.worker;
  }

  public async processJob(job: Job<NotificationJobPayload>): Promise<{ success: boolean; deliveredChannels: string[] }> {
    const payload = job.data;
    logger.info({ jobId: job.id, notificationId: payload.notificationId, recipient: payload.userId }, 'Processing notification job');

    // 1. Check user preferences
    const allowedChannels = await this.filterChannelsByPreferences(
      payload.userId,
      payload.channels,
      payload.type,
      payload.priority
    );

    if (allowedChannels.length === 0) {
      logger.info({ userId: payload.userId, type: payload.type }, 'Notification suppressed by user preferences');
      await query(
        `UPDATE notifications
         SET status = 'suppressed', updated_at = NOW()
         WHERE id = $1`,
        [payload.notificationId]
      );
      return { success: true, deliveredChannels: [] };
    }

    const deliveryResults: DeliveryResult[] = [];
    let hasRetryableFailure = false;

    // 2. Deliver to allowed channels
    for (const channelName of allowedChannels) {
      const channel = this.channels.get(channelName);
      if (!channel) continue;

      try {
        const results = await channel.deliver({
          notificationId: payload.notificationId,
          eventId: payload.eventId,
          userId: payload.userId,
          actorId: payload.actorId,
          type: payload.type,
          title: payload.title,
          body: payload.body,
          data: payload.data,
          priority: payload.priority,
        });

        deliveryResults.push(...results);

        for (const res of results) {
          if (!res.success && res.isRetryable) {
            hasRetryableFailure = true;
          }
        }
      } catch (err: any) {
        logger.error({ channel: channelName, err: err.message }, 'Channel delivery failure');
        deliveryResults.push({
          channel: channelName as any,
          success: false,
          recipientId: payload.userId,
          error: err.message,
          isRetryable: true,
        });
        hasRetryableFailure = true;
      }
    }

    // 3. Persist delivery logs & update notification status
    const anySuccess = deliveryResults.some((r) => r.success);
    const deliveredChannels = deliveryResults.filter((r) => r.success).map((r) => r.channel);

    await withTransaction(async (client) => {
      for (const res of deliveryResults) {
        await client.query(
          `INSERT INTO notification_deliveries (
             notification_id, channel, device_token, status, attempts, last_error, delivered_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            payload.notificationId,
            res.channel,
            res.deviceToken || null,
            res.success ? 'success' : 'failed',
            job.attemptsMade + 1,
            res.error || null,
            res.success ? new Date() : null,
          ]
        );
      }

      if (anySuccess) {
        await client.query(
          `UPDATE notifications
           SET status = 'delivered', delivered_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [payload.notificationId]
        );
      } else if (!hasRetryableFailure) {
        await client.query(
          `UPDATE notifications
           SET status = 'failed', updated_at = NOW()
           WHERE id = $1`,
          [payload.notificationId]
        );
      }
    });

    // If a channel had a transient network/rate-limit error and no channel succeeded, fail job for BullMQ retry
    if (!anySuccess && hasRetryableFailure) {
      throw new Error(`Transient delivery failure across channels: ${deliveryResults.map((r) => r.error).join(', ')}`);
    }

    return { success: anySuccess, deliveredChannels };
  }

  private async filterChannelsByPreferences(
    userId: string,
    requestedChannels: ('websocket' | 'fcm' | 'email')[],
    eventType: string,
    priority: string
  ): Promise<('websocket' | 'fcm' | 'email')[]> {
    // Urgent alerts bypass quiet hours and social suppression
    if (priority === 'urgent') {
      return requestedChannels;
    }

    try {
      const res = await query<{
        channel: string;
        enabled: boolean;
        quiet_hours_start: string | null;
        quiet_hours_end: string | null;
      }>(
        `SELECT channel, enabled, quiet_hours_start, quiet_hours_end
         FROM notification_preferences
         WHERE user_id = $1 AND (event_type = $2 OR event_type = '*')`,
        [userId, eventType]
      );

      if (res.rows.length === 0) {
        return requestedChannels;
      }

      const prefMap = new Map<string, { enabled: boolean; inQuietHours: boolean }>();
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      for (const row of res.rows) {
        let inQuiet = false;
        if (row.quiet_hours_start && row.quiet_hours_end) {
          const [sh, sm] = row.quiet_hours_start.split(':').map(Number);
          const [eh, em] = row.quiet_hours_end.split(':').map(Number);
          const startMin = sh * 60 + sm;
          const endMin = eh * 60 + em;

          if (startMin <= endMin) {
            inQuiet = currentMinutes >= startMin && currentMinutes <= endMin;
          } else {
            // Overnights (e.g., 22:00 to 07:00)
            inQuiet = currentMinutes >= startMin || currentMinutes <= endMin;
          }
        }

        prefMap.set(row.channel, {
          enabled: row.enabled,
          inQuietHours: inQuiet,
        });
      }

      return requestedChannels.filter((ch) => {
        const pref = prefMap.get(ch);
        if (!pref) return true;
        if (!pref.enabled) return false;
        if (pref.inQuietHours && priority !== 'important') return false;
        return true;
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to check preferences; defaulting to requested channels');
      return requestedChannels;
    }
  }

  public async close(): Promise<void> {
    if (this.worker) {
      logger.info('Closing Notification Worker');
      await this.worker.close();
      this.worker = null;
    }
  }
}

export const notificationWorker = new NotificationWorker();
