import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { asyncHandler, ValidationError } from "../utils/errors";
import { currentUser } from "../middleware/auth";
import { isValidEmail } from "../services/recipients.service";

const createSenderSchema = z.object({
  fromName: z.string().min(1).max(120),
  fromEmail: z.string().email().max(254),
  isDefault: z.boolean().optional().default(false),
});

export const listSenders = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  const senders = await prisma.sender.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
  res.json({ senders });
});

export const createSender = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  const parsed = createSenderSchema.safeParse(req.body);
  if (!parsed.success) throw new ValidationError("Invalid sender payload", parsed.error.flatten());
  if (!isValidEmail(parsed.data.fromEmail)) throw new ValidationError("Invalid sender email address");

  const sender = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault) {
      await tx.sender.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
    }
    return tx.sender.create({
      data: { ...parsed.data, userId: user.id, isDefault: parsed.data.isDefault || (await tx.sender.count({ where: { userId: user.id } })) === 0 },
    });
  });
  res.status(201).json({ sender });
});

export const deleteSender = asyncHandler(async (req: Request, res: Response) => {
  const user = currentUser(req);
  const { id } = req.params;
  const sender = await prisma.sender.findFirst({ where: { id, userId: user.id } });
  if (!sender) throw new ValidationError("Sender not found");
  const used = await prisma.emailRecord.count({ where: { senderId: id } });
  if (used > 0) throw new ValidationError("Sender is referenced by existing emails and cannot be deleted");
  await prisma.sender.delete({ where: { id } });
  res.json({ ok: true });
});
