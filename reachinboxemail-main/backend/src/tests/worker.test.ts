import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { prisma } from "../config/prisma";
import { emailQueue } from "../queues/email.queue";
import { createEmailWorker } from "../workers/email.worker";
import { redis } from "../config/redis";
import { cleanupUser, seedUser } from "./helpers";
import type { Worker } from "bullmq";

// Mock ONLY the SMTP transport call — everything else (DB, Redis, BullMQ, ES) is real.
const sendEmailMock = vi.fn(async () => ({ messageId: "<test-123@ethereal.email>", info: "" }));
vi.mock("../services/mailer.service", () => ({
  sendEmail: () => sendEmailMock(),
  isTransientSmtpError: () => false,
  getTransporter: vi.fn(),
}));

let account: Awaited<ReturnType<typeof seedUser>>;
let worker: Worker;

const waitUntil = async (fn: () => Promise<boolean>, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

beforeAll(async () => {
  account = await seedUser("worker");
  worker = createEmailWorker();
});

afterAll(async () => {
  await worker.close();
  await cleanupUser(account.user.id);
});

async function makeCampaign(recipients: string[], hourlyLimit: number, opts: { delayMs?: number; inFutureMs?: number } = {}) {
  const campaign = await prisma.campaign.create({
    data: {
      userId: account.user.id,
      senderId: account.sender.id,
      subject: "Worker test campaign",
      body: "hello",
      startTime: new Date(),
      delayMs: 0,
      hourlyLimit,
      totalEmails: recipients.length,
    },
  });
  const rows: { id: string; jobId: string }[] = [];
  for (const [i, recipient] of recipients.entries()) {
    const id = crypto.randomUUID();
    await prisma.emailRecord.create({
      data: {
        id,
        jobId: id,
        campaignId: campaign.id,
        userId: account.user.id,
        senderId: account.sender.id,
        recipient,
        subject: "Worker test campaign",
        body: "hello",
        scheduledAt: new Date(Date.now() + (opts.inFutureMs ?? 0) + i * (opts.delayMs ?? 0)),
        sequence: i,
      },
    });
    rows.push({ id, jobId: id });
  }
  return { campaign, rows };
}

describe("worker: email state transitions + idempotency", () => {
  it("processes delayed jobs and transitions SCHEDULED -> SENT", async () => {
    sendEmailMock.mockClear();
    const { rows } = await makeCampaign(["w1@worker.test"], 100);
    const when = Date.now() + 800; // a delayed job, like the real scheduler creates
    await emailQueue.add("send-email", { emailId: rows[0].id, campaignId: "x" }, { jobId: rows[0].jobId, delay: 800 });

    // Not sent before the delay elapses
    await new Promise((r) => setTimeout(r, 200));
    expect((await prisma.emailRecord.findUniqueOrThrow({ where: { id: rows[0].id } })).status).toBe("SCHEDULED");

    const sent = await waitUntil(async () => {
      const e = await prisma.emailRecord.findUniqueOrThrow({ where: { id: rows[0].id } });
      return e.status === "SENT";
    });
    expect(sent).toBe(true);
    expect(when).toBeLessThanOrEqual(Date.now());
    const email = await prisma.emailRecord.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(email.sentAt).not.toBeNull();
    expect(email.messageId).toContain("ethereal");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it("a re-run job for an already-SENT email never sends again (duplicate prevention)", async () => {
    const done = await prisma.emailRecord.findFirstOrThrow({ where: { recipient: "w1@worker.test" } });
    const callsBefore = sendEmailMock.mock.calls.length;
    // Simulate a duplicate/retried delivery of the same email under a fresh jobId.
    const dupId = `${done.id}-dup1`;
    await emailQueue.add("send-email", { emailId: done.id, campaignId: done.campaignId }, { jobId: dupId });
    await new Promise((r) => setTimeout(r, 2000));
    expect(sendEmailMock.mock.calls.length).toBe(callsBefore);
    const after = await prisma.emailRecord.findUniqueOrThrow({ where: { id: done.id } });
    expect(after.status).toBe("SENT");
    const dup = await emailQueue.getJob(dupId);
    if (dup) await dup.remove();
  });

  it("the DB claim transition is atomic (only one worker can take an email)", async () => {
    const id = crypto.randomUUID();
    await prisma.emailRecord.create({
      data: {
        id,
        jobId: id,
        campaignId: (await prisma.campaign.findFirstOrThrow({ where: { userId: account.user.id } })).id,
        userId: account.user.id,
        senderId: account.sender.id,
        recipient: "race@worker.test",
        subject: "race",
        body: "x",
        scheduledAt: new Date(),
        sequence: 99,
      },
    });
    const first = await prisma.emailRecord.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "SENDING" } });
    const second = await prisma.emailRecord.updateMany({ where: { id, status: "SCHEDULED" }, data: { status: "SENDING" } });
    expect(first.count).toBe(1);
    expect(second.count).toBe(0);
    await prisma.emailRecord.delete({ where: { id } });
  });
});

describe("worker: hourly rate limit reschedules instead of failing", () => {
  it("sends exactly up to the hourly limit and keeps the rest delayed + SCHEDULED", async () => {
    sendEmailMock.mockClear();
    const { campaign, rows } = await makeCampaign(["rl1@worker.test", "rl2@worker.test", "rl3@worker.test"], 1);
    await redis.del(`slack:notified:${campaign.id}:${Math.floor(Date.now() / 3_600_000)}`);
    for (const r of rows) {
      await emailQueue.add("send-email", { emailId: r.id, campaignId: campaign.id }, { jobId: r.jobId, delay: 0 });
    }
    // Give the pipeline time: 1 sends; the other two reschedule to the next window.
    await new Promise((r) => setTimeout(r, 9000));

    const emails = await prisma.emailRecord.findMany({ where: { campaignId: campaign.id } });
    const sent = emails.filter((e) => e.status === "SENT");
    const scheduled = emails.filter((e) => e.status === "SCHEDULED");
    expect(sent).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
    expect(emails.some((e) => e.status === "FAILED")).toBe(false);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // The blocked jobs must be in the delayed state (rescheduled), not failed.
    for (const e of scheduled) {
      const job = await emailQueue.getJob(e.id);
      expect(job).not.toBeNull();
      expect(await job!.getState()).toBe("delayed");
      await job!.remove(); // cleanup — real system would send next hour
    }
  }, 40_000);
});

describe("worker: failure handling", () => {
  it("marks emails FAILED when sending fails permanently", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("550 relay permanently rejected"));
    const { rows } = await makeCampaign(["fail@worker.test"], 100);
    await emailQueue.add(
      "send-email",
      { emailId: rows[0].id, campaignId: "x" },
      { jobId: rows[0].jobId, delay: 0, attempts: 1 },
    );
    const failed = await waitUntil(async () => {
      const e = await prisma.emailRecord.findUniqueOrThrow({ where: { id: rows[0].id } });
      return e.status === "FAILED";
    });
    expect(failed).toBe(true);
    const email = await prisma.emailRecord.findUniqueOrThrow({ where: { id: rows[0].id } });
    expect(email.lastError).toContain("550");
  });
});
