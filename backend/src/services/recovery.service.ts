import { prisma } from "../config/prisma";
import { bullConnection } from "../config/redis";
import { logger } from "../config/logger";
import { EMAIL_QUEUE_NAME, scheduleEmailJob } from "../queues/email.queue";
import { checkCampaignsCompleted } from "./campaign.service";

const STUCK_SENDING_MS = 5 * 60_000;
const CHUNK = 500;

/**
 * Startup reconciliation — makes restart handling reliable regardless of what
 * was running when the process died. The database is the source of truth.
 *
 * 1. Emails stuck in SENDING (worker died mid-job) become SCHEDULED again.
 *    The 5-minute window avoids stealing jobs from a healthy worker in another
 *    live instance.
 * 2. Emails the DB believes are SCHEDULED but whose BullMQ job key no longer
 *    exists in Redis (e.g. Redis was flushed/volume lost) are re-enqueued with
 *    their original schedule. Deterministic jobIds make this duplicate-safe.
 *
 * Normal backend restarts need nothing here: delayed jobs already live in
 * persistent Redis. This is the safety net.
 */
export async function reconcileOnStartup(): Promise<void> {
  const reset = await prisma.emailRecord.updateMany({
    where: { status: "SENDING", updatedAt: { lt: new Date(Date.now() - STUCK_SENDING_MS) } },
    data: { status: "SCHEDULED" },
  });
  if (reset.count > 0) logger.warn({ count: reset.count }, "Recovery: reset stuck SENDING emails");

  const pending = await prisma.emailRecord.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, campaignId: true, scheduledAt: true },
    orderBy: { scheduledAt: "asc" },
  });

  let rearmed = 0;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    const keys = chunk.map((e) => `bull:${EMAIL_QUEUE_NAME}:${e.id}`);
    const existing = await bullConnection.mget(keys);
    for (let j = 0; j < chunk.length; j++) {
      if (!existing[j]) {
        // Job vanished from Redis — re-arm (delay recomputed from scheduledAt).
        await scheduleEmailJob(chunk[j].id, chunk[j].campaignId, chunk[j].scheduledAt);
        rearmed++;
      }
    }
  }
  if (rearmed > 0) logger.warn({ rearmed }, "Recovery: re-enqueued emails with missing jobs");

  await checkCampaignsCompleted();
  logger.info({ scheduled: pending.length }, `Startup reconciliation complete (${rearmed} jobs re-armed)`);
}
