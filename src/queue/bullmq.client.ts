import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('RedisClient');

let redisClient: Redis | null = null;
let isRedisAvailable = false;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times) {
        const delay = Math.min(times * 1000, 15000);
        logger.warn({ attempt: times, nextRetryInMs: delay }, 'Redis connection retry...');
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Redis client connected');
      isRedisAvailable = true;
    });

    redisClient.on('ready', () => {
      logger.info('Redis client ready');
      isRedisAvailable = true;
    });

    redisClient.on('error', (err) => {
      logger.warn({ err: err.message }, 'Redis client error');
      isRedisAvailable = false;
    });

    redisClient.on('close', () => {
      logger.warn('Redis client connection closed');
      isRedisAvailable = false;
    });
  }

  return redisClient;
}

export function isRedisConnected(): boolean {
  return isRedisAvailable;
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const client = getRedisClient();
    const pong = await client.ping();
    return pong === 'PONG';
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Redis health ping failed');
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    logger.info('Closing Redis connection');
    await redisClient.quit();
    redisClient = null;
    isRedisAvailable = false;
  }
}
