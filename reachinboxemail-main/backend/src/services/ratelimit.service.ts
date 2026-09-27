import { redis } from "../config/redis";
import { env } from "../config/env";

/**
 * Redis-backed hourly rate limiting — safe across multiple workers and app instances.
 *
 * Two fixed-window counters are consumed atomically (single Lua script):
 *  1. per-campaign counter, limit = campaign.hourlyLimit (user-configurable in Compose)
 *  2. global counter,       limit = HOURLY_EMAIL_LIMIT env (system-wide hard cap)
 *
 * A send is allowed only if BOTH counters are below their limits. The window key
 * is the UTC hour bucket, so the window rolls over at the top of each hour.
 */

const HOUR_MS = 3_600_000;

export function currentWindowBucket(now = Date.now()): number {
  return Math.floor(now / HOUR_MS);
}

function campaignKey(bucket: number, campaignId: string): string {
  return `email:rate:campaign:${campaignId}:${bucket}`;
}

function globalKey(bucket: number): string {
  return `email:rate:global:${bucket}`;
}

// Lua: atomically check + increment both counters. Only increments when allowed.
// KEYS[1]=campaignKey KEYS[2]=globalKey ARGV[1]=campaignLimit ARGV[2]=globalLimit ARGV[3]=ttlSeconds
// Returns { allowed, campaignCount, globalCount }
const CONSUME_SCRIPT = `
local cVal = redis.call('GET', KEYS[1])
local gVal = redis.call('GET', KEYS[2])
local cCount = tonumber(cVal) or 0
local gCount = tonumber(gVal) or 0
if cCount >= tonumber(ARGV[1]) then
  return {0, cCount, gCount}
end
if gCount >= tonumber(ARGV[2]) then
  return {0, cCount, gCount}
end
cCount = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
gCount = redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return {1, cCount, gCount}
`;

export interface RateLimitResult {
  allowed: boolean;
  /** ms until the current hourly window rolls over (when allowed=false) */
  retryAfterMs: number;
  campaignCount: number;
  globalCount: number;
  windowBucket: number;
}

export async function tryConsumeSendSlot(campaignId: string, campaignLimit: number): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = currentWindowBucket(now);
  const ttlSeconds = Math.ceil(HOUR_MS / 1000) * 2; // keep keys a bit past rollover
  const raw = (await redis.eval(
    CONSUME_SCRIPT,
    2,
    campaignKey(bucket, campaignId),
    globalKey(bucket),
    String(campaignLimit),
    String(env.HOURLY_EMAIL_LIMIT),
    String(ttlSeconds),
  )) as [number, number, number];

  const allowed = raw[0] === 1;
  return {
    allowed,
    retryAfterMs: bucket * HOUR_MS + HOUR_MS - now,
    campaignCount: Number(raw[1]),
    globalCount: Number(raw[2]),
    windowBucket: bucket,
  };
}

/** Timestamp (ms) at which the next hourly window starts. */
export function nextWindowStart(bucket: number): number {
  return (bucket + 1) * HOUR_MS;
}
