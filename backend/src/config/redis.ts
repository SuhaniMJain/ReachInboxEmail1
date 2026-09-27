import IORedis, { Redis } from "ioredis";
import { env } from "./env";
import { logger } from "./logger";

/**
 * A dedicated connection for BullMQ (maxRetriesPerRequest must be null),
 * and a general-purpose connection for rate limiting / gates / OAuth state.
 */
export const bullConnection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
});

export const redis: Redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
});

bullConnection.on("error", (err) => logger.error({ err }, "Redis (bull) connection error"));
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
