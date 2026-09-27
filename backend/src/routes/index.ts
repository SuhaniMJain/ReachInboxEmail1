import { Router } from "express";
import multer from "multer";
import { googleLogin, googleCallback, logout, me } from "../controllers/auth.controller";
import { uploadRecipients, schedule, scheduledEmails, sentEmails } from "../controllers/emails.controller";
import { slackConnect, slackCallback, slackStatus } from "../controllers/slack.controller";
import { listSenders, createSender, deleteSender } from "../controllers/senders.controller";
import { health } from "../controllers/health.controller";
import { requireAuth } from "../middleware/auth";

export const router = Router();

// --- Auth (real Google OAuth) ---
router.get("/health", health);
router.get("/api/auth/google/login", googleLogin);
router.get("/api/auth/google/callback", googleCallback);
router.post("/api/auth/logout", logout);
router.get("/api/auth/me", requireAuth, me);

// --- Senders (multiple sender support) ---
router.get("/api/senders", requireAuth, listSenders);
router.post("/api/senders", requireAuth, createSender);
router.delete("/api/senders/:id", requireAuth, deleteSender);

// --- Upload / scheduling / search ---
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
router.post("/api/emails/upload", requireAuth, upload.single("file"), uploadRecipients);
router.post("/api/emails/schedule", requireAuth, schedule);
router.get("/api/emails/scheduled", requireAuth, scheduledEmails);
router.get("/api/emails/sent", requireAuth, sentEmails);

// --- Slack (real OAuth + status) ---
router.get("/api/slack/connect", requireAuth, slackConnect);
router.get("/api/slack/callback", slackCallback);
router.get("/api/slack/status", requireAuth, slackStatus);
