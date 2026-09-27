import crypto from "node:crypto";
import { prisma } from "../config/prisma";
import { redis } from "../config/redis";
import { env } from "../config/env";
import type { User } from "@prisma/client";

const SESSION_COOKIE = env.SESSION_COOKIE_NAME;
const TTL_MS = env.SESSION_TTL_DAYS * 24 * 3600 * 1000;

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: { token, userId, expiresAt: new Date(Date.now() + TTL_MS) },
  });
  return token;
}

export async function getSessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } });
}

/** Short-lived OAuth anti-CSRF state, stored in Redis (works across instances). */
export async function putOAuthState(key: string, value: string, ttlSeconds = 600): Promise<void> {
  await redis.set(`oauth:state:${key}`, value, "EX", ttlSeconds);
}

export async function takeOAuthState(key: string): Promise<string | null> {
  const val = await redis.getdel(`oauth:state:${key}`);
  return val;
}

export function randomState(): string {
  return crypto.randomBytes(16).toString("hex");
}
