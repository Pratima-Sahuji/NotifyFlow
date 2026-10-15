import crypto from 'crypto';
import { withTransaction, query } from '../../database/connection.js';
import { CreateEventInput } from './events.schema.js';
import { enqueueNotificationJob, NotificationJobPayload } from '../../queue/notification.queue.js';
import { createChildLogger } from '../../config/logger.js';
import { isRedisConnected } from '../../queue/bullmq.client.js';

const logger = createChildLogger('EventsService');

export interface CreatedEventResult {
  eventId: string;
  eventType: string;
  title: string;
  body: string;
  recipientsCount: number;
  notificationsCreated: string[];
  status: string;
  createdAt: string;
}

export class EventsService {
  public async createEvent(
    actorId: string,
    input: CreateEventInput,
    idempotencyKey?: string
  ): Promise<CreatedEventResult> {
    const eventId = crypto.randomUUID();
    const createdNotificationIds: string[] = [];
    const jobsToEnqueue: NotificationJobPayload[] = [];

    // Filter out sender if accidentally included (unless explicitly intended)
    const distinctRecipients = Array.from(new Set(input.recipients));

    await withTransaction(async (client) => {
      // 1. Insert Event
      await client.query(
        `INSERT INTO events (
           id, idempotency_key, actor_id, event_type, title, body, data, channels, recipients, priority, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
        [
          eventId,
          idempotencyKey || null,
          actorId,
          input.eventType,
          input.title,
          input.body,
          JSON.stringify(input.data),
          input.channels,
          JSON.stringify(distinctRecipients),
          input.priority,
        ]
      );

      // 2. Fan-out into Notifications and Outbox
      for (const recipientId of distinctRecipients) {
        const notificationId = crypto.randomUUID();
        createdNotificationIds.push(notificationId);

        await client.query(
          `INSERT INTO notifications (
             id, event_id, user_id, actor_id, type, title, body, data, priority, status
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')`,
          [
            notificationId,
            eventId,
            recipientId,
            actorId,
            input.eventType,
            input.title,
            input.body,
            JSON.stringify(input.data),
            input.priority,
          ]
        );

        const jobPayload: NotificationJobPayload = {
          eventId,
          notificationId,
          userId: recipientId,
          actorId,
          type: input.eventType,
          title: input.title,
          body: input.body,
          data: input.data,
          channels: input.channels,
          priority: input.priority,
          createdAt: new Date().toISOString(),
        };

        jobsToEnqueue.push(jobPayload);

        // 3. Insert into Transactional Outbox
        await client.query(
          `INSERT INTO outbox (
             id, event_id, queue_name, payload, status
           ) VALUES ($1, $2, 'notifications', $3, 'pending')`,
          [crypto.randomUUID(), eventId, JSON.stringify(jobPayload)]
        );
      }
    });

    // 4. Asynchronously attempt direct BullMQ dispatch if Redis is online
    // If Redis is offline, the Outbox Relayer worker will automatically relay from PostgreSQL outbox table!
    if (isRedisConnected()) {
      for (const job of jobsToEnqueue) {
        enqueueNotificationJob(job).catch((err) => {
          logger.warn({ notificationId: job.notificationId, err: err.message }, 'Direct BullMQ enqueue failed; outbox will retry');
        });
      }
    } else {
      logger.info({ eventId }, 'Redis not currently available; jobs queued durably in Outbox table');
    }

    return {
      eventId,
      eventType: input.eventType,
      title: input.title,
      body: input.body,
      recipientsCount: distinctRecipients.length,
      notificationsCreated: createdNotificationIds,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
  }

  public async getEventById(eventId: string) {
    const res = await query(
      `SELECT e.*, 
              (SELECT count(*) FROM notifications n WHERE n.event_id = e.id) as total_notifications,
              (SELECT count(*) FROM notifications n WHERE n.event_id = e.id AND n.status = 'delivered') as delivered_notifications
       FROM events e
       WHERE e.id = $1`,
      [eventId]
    );

    if (res.rows.length === 0) return null;
    return res.rows[0];
  }
}

export const eventsService = new EventsService();
