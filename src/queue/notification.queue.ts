import { Queue, QueueEvents, JobsOptions } from 'bullmq';
import { getRedisClient, isRedisConnected } from './bullmq.client.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('NotificationQueue');

export const NOTIFICATION_QUEUE_NAME = 'notifyflow:notifications';

export interface NotificationJobPayload {
  eventId: string;
  notificationId: string;
  userId: string;
  actorId?: string | null;
  type: string;
  title: string;
  body: string;
  data: Record<string, any>;
  channels: ('websocket' | 'fcm' | 'email')[];
  priority: 'low' | 'normal' | 'important' | 'urgent';
  createdAt: string;
}

const PRIORITY_MAP: Record<string, number> = {
  urgent: 1,
  important: 2,
  normal: 3,
  low: 4,
};

let notificationQueue: Queue<NotificationJobPayload> | null = null;
let queueEvents: QueueEvents | null = null;

export function getNotificationQueue(): Queue<NotificationJobPayload> {
  if (!notificationQueue) {
    const connection = getRedisClient();
    notificationQueue = new Queue<NotificationJobPayload>(NOTIFICATION_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000, // 2s, 4s, 8s, 16s, 32s
        },
        removeOnComplete: {
          age: 3600 * 24, // Keep 24 hours of completed jobs for audit
          count: 5000,
        },
        removeOnFail: {
          age: 3600 * 24 * 7, // Keep 7 days of failed jobs for DLQ inspection
          count: 5000,
        },
      },
    });

    queueEvents = new QueueEvents(NOTIFICATION_QUEUE_NAME, { connection });

    queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error({ jobId, failedReason }, 'Job failed in notification queue');
    });

    queueEvents.on('error', (err) => {
      logger.warn({ err: err.message }, 'QueueEvents error');
    });
  }

  return notificationQueue;
}

export async function enqueueNotificationJob(
  payload: NotificationJobPayload,
  customOptions?: { delay?: number; jobId?: string }
): Promise<string> {
  const queue = getNotificationQueue();

  const priorityScore = PRIORITY_MAP[payload.priority] || 3;
  const options: JobsOptions = {
    priority: priorityScore,
    jobId: customOptions?.jobId || `notif_${payload.notificationId}`,
    delay: customOptions?.delay || 0,
  };

  const job = await queue.add(payload.type, payload, options);
  logger.info({ jobId: job.id, notificationId: payload.notificationId, priority: payload.priority }, 'Enqueued notification job');
  return job.id as string;
}

export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  isRedisAvailable: boolean;
}> {
  const redisAvailable = isRedisConnected();
  if (!redisAvailable) {
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      isRedisAvailable: false,
    };
  }

  try {
    const queue = getNotificationQueue();
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      isRedisAvailable: true,
    };
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to fetch queue metrics');
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      isRedisAvailable: false,
    };
  }
}

export async function getFailedJobs(start = 0, end = 20) {
  const queue = getNotificationQueue();
  const failedJobs = await queue.getFailed(start, end);
  return failedJobs.map((job) => ({
    id: job.id,
    name: job.name,
    data: job.data,
    failedReason: job.failedReason,
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
  }));
}

export async function retryFailedJob(jobId: string): Promise<boolean> {
  const queue = getNotificationQueue();
  const job = await queue.getJob(jobId);
  if (!job) return false;
  await job.retry();
  return true;
}

export async function closeNotificationQueue(): Promise<void> {
  if (queueEvents) {
    await queueEvents.close();
    queueEvents = null;
  }
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
}
