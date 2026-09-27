import type { Request, Response } from "express";
import { env } from "../config/env";
import { asyncHandler, HttpError } from "../utils/errors";
import { currentUser } from "../middleware/auth";
import { getSlackAuthUrl, slackConfigured, exchangeSlackCode, getSlackStatus } from "../services/slack.service";
import { putOAuthState, takeOAuthState, randomState } from "../services/session.service";

/** GET /api/slack/connect — starts the real Slack OAuth flow for the logged-in user. */
export const slackConnect = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  if (!slackConfigured()) {
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=not_configured`);
    return;
  }
  const state = randomState();
  await putOAuthState(`slack:${state}`, user.id);
  res.redirect(getSlackAuthUrl(state));
});

/** GET /api/slack/callback — Slack redirects here; stores the encrypted token. */
export const slackCallback = asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
  if (error) {
    res.redirect(`${env.FRONTEND_URL}/dashboard?slack=error`);
    return;
  }
  if (!code || !state) throw new HttpError(400, "Missing code/state");
  const userId = await takeOAuthState(`slack:${state}`);
  if (!userId) throw new HttpError(400, "Invalid or expired Slack OAuth state");

  await exchangeSlackCode(userId, code);
  res.redirect(`${env.FRONTEND_URL}/dashboard?slack=connected`);
});

/** GET /api/slack/status */
export const slackStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  res.json(await getSlackStatus(user.id));
});
