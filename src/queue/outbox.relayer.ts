import { query, withTransaction } from '../database/connection.js';
import { enqueueNotificationJob, NotificationJobPayload } from './notification.queue.js';
import { isRedisConnected } from './bullmq.client.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('OutboxRelayer');

export interface OutboxRow {
  id: string;
  event_id: string;
  queue_name: string;
  payload: NotificationJobPayload;
  status: string;
  attempts: number;
}

export class OutboxRelayer {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private isRunning = false;
  private pollIntervalMs: number;

  constructor(pollIntervalMs = 3000) {
    this.pollIntervalMs = pollIntervalMs;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ intervalMs: this.pollIntervalMs }, 'Starting Outbox Relayer background loop');
    this.scheduleNext();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Stopped Outbox Relayer background loop');
  }

  private scheduleNext(): void {
    if (!this.isRunning) return;
    this.timer = setTimeout(async () => {
      await this.processPendingOutbox();
      this.scheduleNext();
    }, this.pollIntervalMs);
  }

  public async processPendingOutbox(limit = 50): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      if (!isRedisConnected()) {
        logger.debug('Redis disconnected; pausing outbox relay to prevent message drop');
        return 0;
      }

      // Fetch pending outbox rows with row-level lock SKIP LOCKED to prevent duplicate multi-instance relay
      const selectSql = `
        SELECT id, event_id, queue_name, payload, status, attempts
        FROM outbox
        WHERE status = 'pending' AND attempts < 10
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED;
      `;

      let publishedCount = 0;

      await withTransaction(async (client) => {
        const res = await client.query<OutboxRow>(selectSql, [limit]);
        if (res.rows.length === 0) return;

        for (const row of res.rows) {
          try {
            await enqueueNotificationJob(row.payload, {
              jobId: `outbox_${row.id}`,
            });

            await client.query(
              `UPDATE outbox
               SET status = 'published', published_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [row.id]
            );

            publishedCount++;
          } catch (jobErr: any) {
            logger.warn({ outboxId: row.id, err: jobErr.message }, 'Failed to publish outbox job to BullMQ');
            await client.query(
              `UPDATE outbox
               SET attempts = attempts + 1, last_error = $1
               WHERE id = $2`,
              [jobErr.message, row.id]
            );
          }
        }
      });

      if (publishedCount > 0) {
        logger.info({ count: publishedCount }, 'Successfully relayed outbox events to BullMQ');
      }

      return publishedCount;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error in outbox processing cycle');
      return 0;
    } finally {
      this.isProcessing = false;
    }
  }
}

export const outboxRelayer = new OutboxRelayer();
