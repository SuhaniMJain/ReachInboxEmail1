import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { redis, bullConnection } from "../config/redis";
import { esHealth } from "../services/search.service";
import { emailQueue } from "../queues/email.queue";

/** GET /health — dependency-aware health report. */
export async function health(_req: Request, res: Response): Promise<void> {
  const checks: Record<string, { up: boolean; detail?: string }> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.postgres = { up: true };
  } catch (err) {
    checks.postgres = { up: false, detail: (err as Error).message.slice(0, 200) };
  }

  try {
    const pong = await redis.ping();
    checks.redis = { up: pong === "PONG" };
  } catch (err) {
    checks.redis = { up: false, detail: (err as Error).message.slice(0, 200) };
  }

  try {
    const counts = await emailQueue.getJobCounts("waiting", "delayed", "active", "completed", "failed");
    checks.bullmq = { up: true, detail: JSON.stringify(counts) };
  } catch (err) {
    checks.bullmq = { up: false, detail: (err as Error).message.slice(0, 200) };
  }

  checks.elasticsearch = await esHealth();

  const up = checks.postgres.up && checks.redis.up && checks.bullmq.up;
  res.status(up ? 200 : 503).json({
    status: up ? "ok" : "degraded",
    uptimeSeconds: Math.round(process.uptime()),
    checks,
  });
  void bullConnection; // connections are shared singletons
}
