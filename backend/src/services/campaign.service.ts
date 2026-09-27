import crypto from "node:crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { ValidationError, NotFoundError } from "../utils/errors";
import { scheduleEmailJobs } from "../queues/email.queue";
import { indexEmails, toEmailDoc } from "./search.service";
import { isValidEmail } from "./recipients.service";
import type { EmailRecord, Prisma } from "@prisma/client";

export interface ScheduleInput {
  senderId: string;
  subject: string;
  body: string;
  startTime: string; // ISO datetime
  delayMs: number;
  hourlyLimit: number;
  recipients: string[];
}

const CHUNK = 500;

/**
 * Creates the campaign + one persistent EmailRecord per recipient inside a
 * transaction, then enqueues one deterministic delayed BullMQ job per email
 * (staggered by the configured delay) and indexes them into Elasticsearch.
 * Designed for 1000+ recipients without blocking the API on sending.
 */
export async function createCampaign(userId: string, input: ScheduleInput) {
  const startTime = new Date(input.startTime);
  if (Number.isNaN(startTime.getTime())) {
    throw new ValidationError("startTime must be a valid ISO datetime");
  }
  if (startTime.getTime() < Date.now() - 60_000) {
    throw new ValidationError("startTime must be in the future");
  }
  if (input.recipients.length === 0) {
    throw new ValidationError("At least one recipient is required");
  }
  if (input.recipients.length > env.MAX_RECIPIENTS_PER_FILE) {
    throw new ValidationError(`Too many recipients (max ${env.MAX_RECIPIENTS_PER_FILE})`);
  }
  const invalid = input.recipients.filter((r) => !isValidEmail(r));
  if (invalid.length > 0) {
    throw new ValidationError(`Invalid email addresses: ${invalid.slice(0, 5).join(", ")}`);
  }

  const sender = await prisma.sender.findFirst({ where: { id: input.senderId, userId } });
  if (!sender) throw new NotFoundError("Sender not found (or not owned by you)");

  // Enforce the configured system minimum delay between sends.
  const effectiveDelayMs = Math.max(input.delayMs, env.MIN_EMAIL_DELAY_MS);

  const rows = input.recipients.map((recipient, i): Omit<Prisma.EmailRecordCreateManyInput, "campaignId"> => {
    const id = crypto.randomUUID();
    return {
      id,
      jobId: id, // deterministic job id == email row id
      userId,
      senderId: sender.id,
      recipient: recipient.toLowerCase(),
      subject: input.subject,
      body: input.body,
      scheduledAt: new Date(startTime.getTime() + i * effectiveDelayMs),
      sequence: i,
      status: "SCHEDULED",
    };
  });

  const campaign = await prisma.$transaction(async (tx) => {
    const c = await tx.campaign.create({
      data: {
        userId,
        senderId: sender.id,
        subject: input.subject,
        body: input.body,
        startTime,
        delayMs: effectiveDelayMs,
        hourlyLimit: input.hourlyLimit,
        totalEmails: rows.length,
      },
    });
    await tx.emailRecord.createMany({ data: rows.map((r) => ({ ...r, campaignId: c.id })) });
    return c;
  });

  const created = await prisma.emailRecord.findMany({
    where: { campaignId: campaign.id },
    orderBy: { sequence: "asc" },
  });

  // Enqueue delayed jobs in chunks (BullMQ addBulk) — non-blocking for large lists.
  for (let i = 0; i < created.length; i += CHUNK) {
    await scheduleEmailJobs(
      created.slice(i, i + CHUNK).map((e) => ({
        emailId: e.id,
        campaignId: campaign.id,
        when: e.scheduledAt,
      })),
    );
  }

  // Elasticsearch indexing (single bulk call; failures logged, never thrown).
  const withSender = created.map((e) => ({ ...e, sender }));
  await indexEmails(withSender.map(toEmailDoc));

  logger.info({ campaignId: campaign.id, total: created.length }, "Campaign scheduled");
  return {
    campaignId: campaign.id,
    totalEmails: created.length,
    startTime: campaign.startTime,
    effectiveDelayMs,
    hourlyLimit: campaign.hourlyLimit,
  };
}

export async function hydrateEmailsByIds(userId: string, ids: string[]): Promise<EmailRecord[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.emailRecord.findMany({
    where: { id: { in: ids }, userId }, // defense-in-depth tenant check
    include: { sender: true },
  });
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** Mark campaigns COMPLETED when no SCHEDULED/SENDING emails remain (used by recovery). */
export async function checkCampaignsCompleted(): Promise<void> {
  const done = await prisma.campaign.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  });
  for (const c of done) {
    const remaining = await prisma.emailRecord.count({
      where: { campaignId: c.id, status: { in: ["SCHEDULED", "SENDING"] } },
    });
    if (remaining === 0) {
      await prisma.campaign.update({ where: { id: c.id }, data: { status: "COMPLETED" } });
    }
  }
}
