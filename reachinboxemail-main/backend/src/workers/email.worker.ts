import { Job, Worker } from "bullmq";
import { bullConnection, redis } from "../config/redis";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { EMAIL_QUEUE_NAME, SendEmailJobData } from "../queues/email.queue";
import { tryConsumeSendSlot, nextWindowStart } from "../services/ratelimit.service";
import { acquireSendSlot } from "../services/sendGate.service";
import { sendEmail, isTransientSmtpError } from "../services/mailer.service";
import { indexEmail, toEmailDoc } from "../services/search.service";
import { notifySlackRateLimit } from "../services/slack.service";

/**
 * Email worker.
 *
 * Pipeline per job: load → idempotency guard → atomic claim (DB transaction via
 * conditional update) → hourly rate limit (Redis) → min-delay gate (Redis) →
 * Ethereal SMTP → DB state update → Elasticsearch update.
 *
 * Duplicate prevention:
 *  - jobId is the email row id, so one email maps to exactly one job ever.
 *  - Claim is a conditional `SCHEDULED -> SENDING` update; 0 rows means another
 *    worker owns it (or it is already SENT) — the job exits without sending.
 *  - SENT is terminal: a retried/completed job for a SENT email is a no-op.
 *
 * Rate-limit exceeded is NOT a failure: the job is moveToDelayed()-rescheduled to
 * the next hourly window (never dropped, never permanently failed).
 */

export function createEmailWorker(): Worker<SendEmailJobData> {
  const worker = new Worker<SendEmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job) => processJob(job),
    {
      connection: bullConnection,
      concurrency: env.WORKER_CONCURRENCY, // configured via env, never hardcoded
    },
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "Job failed");
  });
  worker.on("error", (err) => {
    // Expected side effect of rescheduling via job.moveToDelayed() before returning:
    // BullMQ then fails to move the (already delayed) job to finished. Not a real error.
    if (err.message?.includes("Missing lock for job")) return;
    logger.error({ err }, "Worker error");
  });
  return worker;
}

async function processJob(job: Job<SendEmailJobData>): Promise<void> {
  const { emailId } = job.data;

  const email = await prisma.emailRecord.findUnique({
    where: { id: emailId },
    include: { campaign: true },
  });
  if (!email) {
    logger.warn({ emailId }, "Email record missing for job — skipping");
    return;
  }
  // Idempotency: never re-send an email that already reached a terminal state.
  if (email.status === "SENT" || email.status === "FAILED") return;

  // Atomic claim: exactly one worker moves SCHEDULED -> SENDING.
  const claimed = await prisma.emailRecord.updateMany({
    where: { id: email.id, status: "SCHEDULED" },
    data: { status: "SENDING" },
  });
  if (claimed.count === 0) return; // another worker owns it right now

  try {
    // --- Hourly rate limit (shared Redis counters, multi-instance safe) ---
    const limit = await tryConsumeSendSlot(email.campaignId, email.campaign.hourlyLimit);
    if (!limit.allowed) {
      await releaseClaim(email.id);
      const jitterMs = Math.min(email.sequence * 100, 5 * 60_000); // preserve order next hour
      const when = nextWindowStart(limit.windowBucket) + jitterMs;
      await job.moveToDelayed(when, job.token);
      logger.info(
        { emailId: email.id, campaignId: email.campaignId, when: new Date(when).toISOString() },
        "Hourly limit reached — job rescheduled to next window",
      );
      await maybeNotifyRateLimit(email.campaignId, email.userId, email.campaign.hourlyLimit, limit.windowBucket);
      return; // job stays delayed — not failed, not dropped
    }

    // --- Minimum delay between individual sends (Redis gate, worker-safe) ---
    const gate = await acquireSendSlot();
    if (!gate.allowed) {
      await releaseClaim(email.id);
      await job.moveToDelayed(Date.now() + gate.waitMs + 50, job.token);
      return;
    }

    // --- Send through Ethereal SMTP ---
    await prisma.emailRecord.update({ where: { id: email.id }, data: { attempts: { increment: 1 } } });
    const sender = await prisma.sender.findUniqueOrThrow({ where: { id: email.senderId } });
    const result = await sendEmail({
      to: email.recipient,
      subject: email.subject,
      body: email.body,
      sender,
    });

    const sent = await prisma.emailRecord.update({
      where: { id: email.id },
      data: { status: "SENT", sentAt: new Date(), messageId: result.messageId, lastError: null },
      include: { sender: true },
    });
    indexEmail(toEmailDoc(sent)).catch(() => undefined);
    await checkCampaignCompletion(email.campaignId);
    logger.info({ emailId: email.id, recipient: email.recipient }, "Email sent");
  } catch (err) {
    const exhausted = job.attemptsMade + 1 >= (job.opts.attempts ?? env.EMAIL_MAX_ATTEMPTS);
    const transient = isTransientSmtpError(err);
    const message = (err as Error).message?.slice(0, 1000) ?? "unknown error";

    if (exhausted || !transient) {
      const failed = await prisma.emailRecord.update({
        where: { id: email.id },
        data: { status: "FAILED", lastError: message },
        include: { sender: true },
      });
      indexEmail(toEmailDoc(failed)).catch(() => undefined);
      await checkCampaignCompletion(email.campaignId);
      // Throw so the job lands in the failed set for Bull Board inspection.
      throw err;
    }

    // Transient: release the claim so the BullMQ retry can re-acquire it.
    await releaseClaim(email.id);
    throw err;
  }
}

/** SCHEDULED email back from SENDING (claim release for requeue/retry paths). */
async function releaseClaim(emailId: string): Promise<void> {
  await prisma.emailRecord.updateMany({
    where: { id: emailId, status: "SENDING" },
    data: { status: "SCHEDULED" },
  });
}

/**
 * Slack notification when the hourly limit is hit — at most once per campaign
 * per hourly window (Redis SETNX dedupe). Silently skipped when Slack is not
 * connected; never throws.
 */
async function maybeNotifyRateLimit(campaignId: string, userId: string, limit: number, bucket: number): Promise<void> {
  try {
    const dedupeKey = `slack:notified:${campaignId}:${bucket}`;
    const set = await redis.set(dedupeKey, "1", "EX", 3600, "NX");
    if (!set) return; // already notified this window
    await notifySlackRateLimit(
      userId,
      `⚠️ Hourly email sending limit reached (limit: ${limit}/hour). Remaining queued emails for this campaign have been automatically delayed to the next hour — no emails were lost or failed.`,
    );
  } catch (err) {
    logger.warn({ err }, "Rate-limit Slack notification skipped/failed");
  }
}

async function checkCampaignCompletion(campaignId: string): Promise<void> {
  const remaining = await prisma.emailRecord.count({
    where: { campaignId, status: { in: ["SCHEDULED", "SENDING"] } },
  });
  if (remaining === 0) {
    await prisma.campaign.updateMany({ where: { id: campaignId, status: "PENDING" }, data: { status: "COMPLETED" } });
  }
}
