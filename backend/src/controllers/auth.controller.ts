import type { Request, Response } from "express";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { logger } from "../config/logger";
import { asyncHandler, HttpError } from "../utils/errors";
import { getGoogleAuthUrl, googleConfigured, exchangeGoogleCode } from "../services/google.service";
import {
  createSession,
  deleteSession,
  putOAuthState,
  takeOAuthState,
  randomState,
  sessionCookieName,
} from "../services/session.service";
import { currentUser } from "../middleware/auth";

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: "none" as const,
    secure: env.FRONTEND_URL.startsWith("https://"),
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** Start the real Google OAuth flow. Misconfiguration redirects back to the login UI. */
export const googleLogin = asyncHandler(async (_req: Request, res: Response) => {
  if (!googleConfigured()) {
    res.redirect(`${env.FRONTEND_URL}/login?error=google_not_configured`);
    return;
  }
  const state = randomState();
  await putOAuthState(`google:${state}`, "login");
  res.redirect(getGoogleAuthUrl(state));
});

export const googleCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) throw new HttpError(401, `Google OAuth error: ${error}`);
  if (!code || !state) throw new HttpError(400, "Missing code/state");
  const stored = await takeOAuthState(`google:${state}`);
  if (!stored) throw new HttpError(400, "Invalid or expired OAuth state");

  const profile = await exchangeGoogleCode(code);
  const user = await prisma.user.upsert({
    where: { googleId: profile.googleId },
    create: profile,
    update: { email: profile.email, name: profile.name, avatarUrl: profile.avatarUrl },
  });

  // Every user gets a default sender; more senders can be added via the API/UI.
  const senderCount = await prisma.sender.count({ where: { userId: user.id } });
  if (senderCount === 0) {
    await prisma.sender.create({
      data: {
        userId: user.id,
        fromName: user.name,
        fromEmail: env.SMTP_USER || user.email,
        isDefault: true,
      },
    });
  }

  const token = await createSession(user.id);
  res.cookie(sessionCookieName(), token, cookieOptions(env.SESSION_TTL_DAYS * 24 * 3600 * 1000));
  logger.info({ userId: user.id }, "User logged in via Google");
  res.redirect(`${env.FRONTEND_URL}/dashboard`);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await deleteSession(req.cookies?.[sessionCookieName()]);
  res.clearCookie(sessionCookieName(), { path: "/" });
  res.json({ ok: true });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  const senders = await prisma.sender.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl },
    senders,
  });
});
