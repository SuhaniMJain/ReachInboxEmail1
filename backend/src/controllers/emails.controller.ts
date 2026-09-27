import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler, ValidationError } from "../utils/errors";
import { currentUser } from "../middleware/auth";
import { parseRecipientsFile } from "../services/recipients.service";
import { createCampaign, hydrateEmailsByIds } from "../services/campaign.service";
import { searchEmails } from "../services/search.service";
import type { EmailRecord, EmailStatus } from "@prisma/client";

/** POST /api/emails/upload — multipart file (CSV/TXT leads). Returns parsed recipients. */
export const uploadRecipients = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file || !req.file.buffer) {
    throw new ValidationError("Upload a CSV/text file containing recipient email addresses (field name: file)");
  }
  const content = req.file.buffer.toString("utf8");
  const recipients = parseRecipientsFile(content);
  res.json({ count: recipients.length, recipients });
});

export const scheduleSchema = z.object({
  senderId: z.string().min(1),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100_000),
  startTime: z.string().min(1),
  delayMs: z.number().int().min(0).max(24 * 3600_000),
  hourlyLimit: z.number().int().min(1).max(100_000),
  recipients: z.array(z.string().min(3).max(254)).min(1).max(10_000),
});

/** POST /api/emails/schedule — persist campaign + enqueue delayed BullMQ jobs. */
export const schedule = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  const input = scheduleSchema.parse(req.body); // validated by middleware too
  const result = await createCampaign(user.id, input);
  res.status(201).json(result);
});

const searchQuerySchema = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function toDto(e: EmailRecord & { sender?: { fromName: string; fromEmail: string } }) {
  return {
    id: e.id,
    recipient: e.recipient,
    subject: e.subject,
    status: e.status,
    scheduledAt: e.scheduledAt,
    sentAt: e.sentAt,
    messageId: e.messageId,
    lastError: e.lastError,
    attempts: e.attempts,
    sender: e.sender ? { name: e.sender.fromName, email: e.sender.fromEmail } : null,
  };
}

async function searchByStatuses(req: Request, statuses: EmailStatus[]) {
  const user = currentUser(req);
  const parsed = searchQuerySchema.safeParse(req.query);
  if (!parsed.success) throw new ValidationError("Invalid query parameters", parsed.error.flatten());
  const { q, page, pageSize } = parsed.data;

  const result = await searchEmails({
    userId: user.id,
    statuses,
    query: q,
    page,
    pageSize,
  });
  const rows = await hydrateEmailsByIds(user.id, result.ids);
  return { emails: rows.map(toDto), total: result.total, page, pageSize };
}

/** GET /api/emails/scheduled — Elasticsearch search over SCHEDULED/SENDING emails. */
export const scheduledEmails = asyncHandler(async (req: Request, res: Response) => {
  res.json(await searchByStatuses(req, ["SCHEDULED", "SENDING"]));
});

/** GET /api/emails/sent — Elasticsearch search over SENT/FAILED emails. */
export const sentEmails = asyncHandler(async (req: Request, res: Response) => {
  res.json(await searchByStatuses(req, ["SENT", "FAILED"]));
});
