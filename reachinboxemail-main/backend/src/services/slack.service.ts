import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { HttpError } from "../utils/errors";
import { encryptSecret, decryptSecret } from "../utils/crypto";

/**
 * Real Slack OAuth (v2). "Connect Slack" sends the user to slack.com;
 * the callback stores the bot token (encrypted) against the user's account.
 * When the hourly limit is hit the worker DMs the connected user via the bot.
 * If the user has no Slack connection, notifications are silently skipped.
 */

const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize"; // v2 handles bot + user scopes in one consent; /openid/connect/authorize rejects bot `scope`
const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_CONVERSATIONS_OPEN = "https://slack.com/api/conversations.open";
const SLACK_CHAT_POST = "https://slack.com/api/chat.postMessage";

export function slackConfigured(): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET && env.SLACK_REDIRECT_URI);
}

export function getSlackAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: env.SLACK_BOT_SCOPES, // bot scopes: chat:write, im:write
    user_scope: "openid,email,profile", // OpenID Connect user scopes (must match app config)
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
    response_type: "code",
  });
  return `${SLACK_AUTHORIZE_URL}?${params.toString()}`;
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  bot_user_id?: string;
  scope?: string;
  team?: { id?: string; name?: string };
  authed_user?: { id?: string };
}

/** Exchange the OAuth code and upsert the SlackConnection for the user. */
export async function exchangeSlackCode(userId: string, code: string): Promise<{ teamName: string | null }> {
  const res = await fetch(SLACK_OAUTH_ACCESS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.access_token || !data.authed_user?.id) {
    throw new HttpError(502, `Slack OAuth failed: ${data.error ?? "missing fields in response"}`);
  }

  await prisma.slackConnection.upsert({
    where: { userId },
    create: {
      userId,
      slackUserId: data.authed_user.id,
      teamId: data.team?.id ?? "unknown",
      teamName: data.team?.name ?? null,
      botId: data.bot_user_id ?? null,
      scopes: data.scope ?? "",
      accessTokenEnc: encryptSecret(data.access_token),
    },
    update: {
      slackUserId: data.authed_user.id,
      teamId: data.team?.id ?? "unknown",
      teamName: data.team?.name ?? null,
      botId: data.bot_user_id ?? null,
      scopes: data.scope ?? "",
      accessTokenEnc: encryptSecret(data.access_token),
    },
  });
  logger.info({ userId, team: data.team?.name }, "Slack connected");
  return { teamName: data.team?.name ?? null };
}

export async function getSlackStatus(userId: string) {
  const conn = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!conn) return { connected: false as const };
  return {
    connected: true as const,
    teamName: conn.teamName,
    slackUserId: conn.slackUserId,
    scopes: conn.scopes,
    connectedAt: conn.updatedAt,
  };
}

/**
 * Send a real DM to the connected Slack user. Never throws — missing
 * connection or Slack API errors are handled without crashing the worker.
 */
export async function notifySlackRateLimit(userId: string, text: string): Promise<void> {
  try {
    const conn = await prisma.slackConnection.findUnique({ where: { userId } });
    if (!conn) return; // not connected → do nothing, not an error
    const token = decryptSecret(conn.accessTokenEnc);

    const openRes = await fetch(SLACK_CONVERSATIONS_OPEN, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ users: conn.slackUserId, return_im: true }),
    });
    const open = (await openRes.json()) as { ok: boolean; error?: string; channel?: { id?: string } };
    if (!open.ok || !open.channel?.id) {
      logger.warn({ err: open.error, userId }, "Slack conversations.open failed");
      return;
    }

    const postRes = await fetch(SLACK_CHAT_POST, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ channel: open.channel.id, text }),
    });
    const post = (await postRes.json()) as { ok: boolean; error?: string };
    if (!post.ok) {
      logger.warn({ err: post.error, userId }, "Slack chat.postMessage failed");
      return;
    }
    logger.info({ userId }, "Slack rate-limit notification sent");
  } catch (err) {
    // Slack problems must never take down email processing.
    logger.warn({ err }, "Slack notification failed (ignored)");
  }
}
