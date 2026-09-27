import { Queue, Job } from "bullmq";
import { bullConnection } from "../config/redis";
import { env } from "../config/env";

export const EMAIL_QUEUE_NAME = "send-emails";

export interface SendEmailJobData {
  emailId: string;
  campaignId: string;
}

/**
 * The queue is durable: jobs live in Redis (AOF-enabled), not in process
 * memory, so delayed jobs fire even if every backend process restarts.
 */
export const emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: {
    attempts: env.EMAIL_MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 5_000 },
    removeOnFail: false, // keep failed jobs for Bull Board inspection
  },
});

/**
 * Schedule one email as a delayed job. The jobId is deterministic (=email row id),
 * so re-adding the same email can never create a duplicate job.
 */
export async function scheduleEmailJob(emailId: string, campaignId: string, when: Date): Promise<void> {
  const delay = Math.max(0, when.getTime() - Date.now());
  await emailQueue.add(
    "send-email",
    { emailId, campaignId },
    { jobId: emailId, delay },
  );
}

export async function scheduleEmailJobs(
  jobs: Array<{ emailId: string; campaignId: string; when: Date }>,
): Promise<void> {
  // addBulk keeps enqueuing 1000+ jobs fast and off the request hot path.
  await emailQueue.addBulk(
    jobs.map((j) => ({
      name: "send-email",
      data: { emailId: j.emailId, campaignId: j.campaignId },
      opts: {
        jobId: j.emailId,
        delay: Math.max(0, j.when.getTime() - Date.now()),
      },
    })),
  );
}

export async function resendNow(emailId: string, campaignId: string): Promise<void> {
  await emailQueue.add("send-email", { emailId, campaignId }, { jobId: emailId, delay: 0 });
}

/** Re-arm an email whose job vanished (Redis wiped / job lost). Safe due to deterministic jobId. */
export async function ensureJobExists(job: Job<SendEmailJobData> | null, emailId: string, campaignId: string, when: Date) {
  if (job) return false;
  await scheduleEmailJob(emailId, campaignId, when);
  return true;
}
