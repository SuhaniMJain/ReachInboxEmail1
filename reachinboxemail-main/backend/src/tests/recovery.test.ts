import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../config/prisma";
import { bullConnection } from "../config/redis";
import { emailQueue } from "../queues/email.queue";
import { reconcileOnStartup } from "../services/recovery.service";
import { createCampaign } from "../services/campaign.service";
import { cleanupUser, futureIso, seedUser } from "./helpers";

let account: Awaited<ReturnType<typeof seedUser>>;
let campaignId: string;
let emailIds: string[] = [];

beforeAll(async () => {
  account = await seedUser("recovery");
  const res = await createCampaign(account.user.id, {
    senderId: account.sender.id,
    subject: "Recovery test campaign",
    body: "x",
    startTime: futureIso(30),
    delayMs: 5000,
    hourlyLimit: 100,
    recipients: ["r1@rec.test", "r2@rec.test", "r3@rec.test"],
  });
  campaignId = res.campaignId;
  emailIds = (
    await prisma.emailRecord.findMany({ where: { campaignId }, select: { id: true }, orderBy: { sequence: "asc" } })
  ).map((e) => e.id);
});

afterAll(async () => {
  for (const id of emailIds) {
    const job = await emailQueue.getJob(id);
    if (job) await job.remove();
  }
  await cleanupUser(account.user.id);
});

describe("restart recovery / reconciliation", () => {
  it("re-arms SCHEDULED emails whose Redis jobs disappeared, without creating duplicates", async () => {
    // Simulate total job loss in Redis for these emails (e.g. volume wiped).
    await bullConnection.del(emailIds.map((id) => `bull:send-emails:${id}`));

    await reconcileOnStartup();

    for (const id of emailIds) {
      const job = await emailQueue.getJob(id);
      expect(job, `job ${id} should be re-armed`).not.toBeNull();
      expect(await job!.getState()).toBe("delayed");
    }
    // Deterministic ids mean exactly one job per email — no duplicates.
    const delayed = await emailQueue.getDelayed(0, 10_000);
    const mine = delayed.filter((j) => emailIds.includes(String(j.id)));
    expect(mine).toHaveLength(3);
  });

  it("resets stuck SENDING rows older than the safety window back to SCHEDULED", async () => {
    const id = emailIds[0];
    await prisma.emailRecord.update({ where: { id }, data: { status: "SENDING" } });
    // Age the row artificially.
    await prisma.$executeRaw`UPDATE "emails" SET updated_at = NOW() - INTERVAL '10 minutes' WHERE id = ${id}`;

    await reconcileOnStartup();

    const email = await prisma.emailRecord.findUniqueOrThrow({ where: { id } });
    expect(email.status).toBe("SCHEDULED");
  });
});
