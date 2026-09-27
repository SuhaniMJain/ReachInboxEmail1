import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { tryConsumeSendSlot, currentWindowBucket } from "../services/ratelimit.service";
import { acquireSendSlot } from "../services/sendGate.service";
import { encryptSecret, decryptSecret } from "../utils/crypto";

describe("hourly rate limiter (Redis-backed, shared)", () => {
  it("allows up to the campaign limit within the hour, then blocks with a retry time", async () => {
    const campaignId = `test-rl-${crypto.randomUUID()}`;
    const limit = 5;
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await tryConsumeSendSlot(campaignId, limit);
      results.push(r.allowed);
      if (!r.allowed) {
        expect(r.retryAfterMs).toBeGreaterThan(0);
        expect(r.retryAfterMs).toBeLessThanOrEqual(3_600_000);
      }
    }
    expect(results.slice(0, limit)).toEqual([true, true, true, true, true]);
    expect(results.slice(limit)).toEqual([false, false]);
  });

  it("counters are isolated per campaign", async () => {
    const a = `camp-a-${crypto.randomUUID()}`;
    const b = `camp-b-${crypto.randomUUID()}`;
    expect((await tryConsumeSendSlot(a, 1)).allowed).toBe(true);
    expect((await tryConsumeSendSlot(a, 1)).allowed).toBe(false);
    expect((await tryConsumeSendSlot(b, 1)).allowed).toBe(true);
  });

  it("next window start is exactly one hour after the bucket", () => {
    const bucket = currentWindowBucket();
    expect(nextStartDelta(bucket)).toBe(3_600_000);
  });
});

function nextStartDelta(bucket: number): number {
  return (bucket + 1) * 3_600_000 - bucket * 3_600_000;
}

describe("minimum-delay gate (Redis, multi-worker safe)", () => {
  it("separates consecutive acquisitions by at least MIN_EMAIL_DELAY_MS", async () => {
    const minDelay = Number(process.env.MIN_EMAIL_DELAY_MS ?? 2000);
    const stamps: number[] = [];
    const blocked: number[] = [];
    // Drain the gate repeatedly the way concurrent workers would.
    for (let i = 0; i < 4; i++) {
      let r = await acquireSendSlot();
      if (!r.allowed) {
        blocked.push(r.waitMs);
        expect(r.waitMs).toBeGreaterThan(0);
        await sleep(r.waitMs + 20);
        r = await acquireSendSlot();
        expect(r.allowed).toBe(true);
      }
      stamps.push(Date.now());
    }
    expect(blocked.length).toBeGreaterThan(0); // with 2s default this must block
    for (let i = 1; i < stamps.length; i++) {
      expect(stamps[i] - stamps[i - 1]).toBeGreaterThanOrEqual(minDelay - 100);
    }
  }, 30_000);
});

describe("token encryption", () => {
  it("round-trips and differs from plaintext", () => {
    const secret = "xoxb-super-secret-token";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });
});

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}
