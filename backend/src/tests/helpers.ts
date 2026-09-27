import crypto from "node:crypto";
import { prisma } from "../config/prisma";
import { createSession } from "../services/session.service";

/**
 * Test helpers: seed a user + sender + session, clean up afterwards.
 * Tests run against the real infrastructure (Postgres/Redis/ES from docker-compose).
 */
export async function seedUser(tag: string) {
  const user = await prisma.user.create({
    data: {
      googleId: `test-${tag}-${crypto.randomUUID()}`,
      email: `${tag}-${crypto.randomUUID().slice(0, 8)}@example.com`,
      name: `Test ${tag}`,
    },
  });
  const sender = await prisma.sender.create({
    data: { userId: user.id, fromName: "Test Sender", fromEmail: "sender@example.com", isDefault: true },
  });
  const token = await createSession(user.id);
  return { user, sender, token };
}

export async function cleanupUser(userId: string): Promise<void> {
  await prisma.emailRecord.deleteMany({ where: { userId } });
  await prisma.campaign.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.sender.deleteMany({ where: { userId } });
  await prisma.slackConnection.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
}

export function cookie(token: string): string {
  return `${process.env.SESSION_COOKIE_NAME ?? "scheduler_session"}=${token}`;
}

export function futureIso(minutesFromNow = 5): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}
