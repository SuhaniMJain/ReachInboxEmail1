import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { Server } from "node:http";
import request from "supertest";
import { emailQueue } from "../queues/email.queue";
import { prisma } from "../config/prisma";
import { searchEmails } from "../services/search.service";
import { cleanupUser, cookie, futureIso, seedUser } from "./helpers";

let server: Server;
let api: ReturnType<typeof request>;
let user: Awaited<ReturnType<typeof seedUser>>;
let user2: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  server = createApp().listen(0);
  api = request(server);
  user = await seedUser("api");
  user2 = await seedUser("api-other");
});

afterAll(async () => {
  await cleanupUser(user.user.id);
  await cleanupUser(user2.user.id);
  server.close();
});

describe("health API", () => {
  it("GET /health reports dependency status", async () => {
    const res = await api.get("/health");
    expect([200, 503]).toContain(res.status);
    expect(res.body.checks).toHaveProperty("postgres");
    expect(res.body.checks.postgres.up).toBe(true);
    expect(res.body.checks.redis.up).toBe(true);
  });
});

describe("authentication authorization boundaries", () => {
  it("rejects unauthenticated access to protected routes", async () => {
    for (const path of ["/api/auth/me", "/api/emails/scheduled", "/api/emails/sent", "/api/senders", "/api/slack/status"]) {
      const res = await api.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it("rejects an invalid session cookie", async () => {
    const res = await api.get("/api/auth/me").set("cookie", "scheduler_session=bogus");
    expect(res.status).toBe(401);
  });

  it("serves the seeded session", async () => {
    const res = await api.get("/api/auth/me").set("cookie", cookie(user.token));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.user.email);
    expect(res.body.senders).toHaveLength(1);
  });
});

describe("upload + scheduling API", () => {
  it("rejects an empty upload", async () => {
    const res = await api
      .post("/api/emails/upload")
      .set("cookie", cookie(user.token))
      .attach("file", Buffer.from(""), "leads.csv");
    expect(res.status).toBe(400);
  });

  it("parses a CSV upload and reports recipient count", async () => {
    const csv = "email\nup1@lead.com\nup2@lead.com\nbad-email\n";
    const res = await api
      .post("/api/emails/upload")
      .set("cookie", cookie(user.token))
      .attach("file", Buffer.from(csv), "leads.csv");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.recipients).toEqual(["up1@lead.com", "up2@lead.com"]);
  });

  it("validates the schedule payload", async () => {
    const res = await api
      .post("/api/emails/schedule")
      .set("cookie", cookie(user.token))
      .send({ senderId: user.sender.id, subject: "", body: "x", startTime: "nope", delayMs: -5, hourlyLimit: 0, recipients: [] });
    expect(res.status).toBe(400);
  });

  it("persists emails, enqueues delayed BullMQ jobs and indexes Elasticsearch", async () => {
    const recipients = Array.from({ length: 25 }, (_, i) => `lead${i}@sched.test`);
    const start = futureIso(10);
    const res = await api
      .post("/api/emails/schedule")
      .set("cookie", cookie(user.token))
      .send({
        senderId: user.sender.id,
        subject: "Quarterly update — sched test",
        body: "Hello there",
        startTime: start,
        delayMs: 2000,
        hourlyLimit: 50,
        recipients,
      });
    expect(res.status).toBe(201);
    expect(res.body.totalEmails).toBe(25);

    // 1. DB rows
    const rows = await prisma.emailRecord.findMany({ where: { campaignId: res.body.campaignId }, orderBy: { sequence: "asc" } });
    expect(rows).toHaveLength(25);
    expect(rows[0].status).toBe("SCHEDULED");
    expect(rows[0].jobId).toBe(rows[0].id); // deterministic job id

    // scheduledAt staggered by delay
    const gap = rows[1].scheduledAt.getTime() - rows[0].scheduledAt.getTime();
    expect(gap).toBeGreaterThanOrEqual(1900);
    expect(gap).toBeLessThanOrEqual(2100);

    // 2. BullMQ delayed jobs exist with the deterministic ids
    const job = await emailQueue.getJob(rows[3].id);
    expect(job, "job with deterministic id must exist").toBeDefined();
    expect(job, "job with deterministic id must exist").not.toBeNull();
    expect(await job!.getState()).toBe("delayed");

    // 3. Elasticsearch indexed the emails (source of truth stays DB)
    const search = await searchEmails({ userId: user.user.id, statuses: ["SCHEDULED", "SENDING"], query: "Quarterly", page: 1, pageSize: 50 });
    expect(search.total).toBeGreaterThanOrEqual(25);

    // 4. scheduled API returns them, scoped to this tenant only
    const list = await api.get("/api/emails/scheduled?q=Quarterly").set("cookie", cookie(user.token));
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(25);
    expect(list.body.emails.every((e: { recipient: string }) => e.recipient.endsWith("@sched.test"))).toBe(true);

    // 5. other tenant cannot see them
    const other = await api.get("/api/emails/scheduled?q=Quarterly").set("cookie", cookie(user2.token));
    expect(other.body.total).toBe(0);

    // cleanup queue jobs (emails never processed — no worker in this file)
    for (const r of rows) {
      const j = await emailQueue.getJob(r.id);
      if (j) await j.remove();
    }
  }, 120_000); // ES/BullMQ on local Docker can be slow to settle

  it("rejects a schedule for another user's sender", async () => {
    const res = await api
      .post("/api/emails/schedule")
      .set("cookie", cookie(user2.token))
      .send({
        senderId: user.sender.id,
        subject: "steal",
        body: "x",
        startTime: futureIso(5),
        delayMs: 1000,
        hourlyLimit: 10,
        recipients: ["z@lead.com"],
      });
    expect(res.status).toBe(404);
  });
});
