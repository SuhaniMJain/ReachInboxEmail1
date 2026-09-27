import { redis } from "../config/redis";
import { env } from "../config/env";

/**
 * Redis-backed minimum-delay gate between individual email sends.
 *
 * A single key holds `nextAllowedAt` (epoch ms). A Lua script atomically either:
 *  - allows the send and pushes nextAllowedAt forward by MIN_EMAIL_DELAY_MS, or
 *  - returns how long the caller must wait.
 *
 * This stays correct with any number of concurrent workers/instances — no
 * in-memory timers. A blocked worker reschedules its BullMQ job instead of
 * sleeping. The Lua script uses Redis server TIME so all workers share one clock.
 */

const GATE_KEY = "email:send:gate";

// KEYS[1]=gate key, ARGV[1]=minDelayMs, ARGV[2]=nowMsFallback
// Returns { allowed(0/1), waitMs }
const GATE_SCRIPT = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
if now < nextAllowed then
  return {0, nextAllowed - now}
end
redis.call('SET', KEYS[1], tostring(now + tonumber(ARGV[1])))
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]) * 10)
return {1, 0}
`;

export interface GateResult {
  allowed: boolean;
  waitMs: number;
}

export async function acquireSendSlot(): Promise<GateResult> {
  if (env.MIN_EMAIL_DELAY_MS <= 0) return { allowed: true, waitMs: 0 };
  const raw = (await redis.eval(GATE_SCRIPT, 1, GATE_KEY, String(env.MIN_EMAIL_DELAY_MS), String(Date.now()))) as
    | [number, number];
  return { allowed: raw[0] === 1, waitMs: Number(raw[1]) };
}
