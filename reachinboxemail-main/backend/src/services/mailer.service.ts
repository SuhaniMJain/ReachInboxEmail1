import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";
import { logger } from "../config/logger";
import type { Sender } from "@prisma/client";

/**
 * Ethereal SMTP transport. Credentials come exclusively from environment
 * variables (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS) — nothing is
 * hardcoded. See README for creating an Ethereal account.
 */
let transporter: Transporter | null = null;

export function getTransporter(): Transporter {
  if (transporter) return transporter;
  if (!env.SMTP_USER || !env.SMTP_PASS) {
    throw new Error(
      "SMTP credentials missing. Create an Ethereal account (see README) and set SMTP_USER / SMTP_PASS in backend/.env",
    );
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export interface SendResult {
  messageId: string;
  info: string;
  /** Public Ethereal preview page for the captured message (no real delivery). */
  previewUrl?: string;
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
  sender: Sender;
}): Promise<SendResult> {
  const t = getTransporter();
  const info = await t.sendMail({
    from: { name: opts.sender.fromName, address: opts.sender.fromEmail },
    to: opts.to,
    subject: opts.subject,
    text: opts.body,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(opts.body)}</div>`,
  });
  // Enough detail to inspect the generated mail in the Ethereal inbox. Ethereal is a
  // sink: the message is captured for preview at previewUrl, never delivered for real.
  const previewUrl = info.ethereal?.link ?? info.ethereal?.url;
  logger.info({ messageId: info.messageId, accepted: info.accepted, previewUrl }, "Email accepted by SMTP");
  return {
    messageId: info.messageId,
    info: typeof info.message === "string" ? info.message : "",
    previewUrl,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** True for errors that are worth retrying (network/temporary SMTP failures). */
export function isTransientSmtpError(err: unknown): boolean {
  const e = err as { code?: string; responseCode?: number };
  if (e?.responseCode && e.responseCode >= 500 && e.responseCode < 600) return false;
  return true;
}
