export type EmailStatus = "SCHEDULED" | "SENDING" | "SENT" | "FAILED";

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

export interface Sender {
  id: string;
  fromName: string;
  fromEmail: string;
  isDefault: boolean;
}

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  messageId: string | null;
  lastError: string | null;
  attempts: number;
  sender: { name: string; email: string } | null;
}

export interface EmailSearchResponse {
  emails: EmailItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SlackStatus {
  connected: boolean;
  teamName?: string | null;
  slackUserId?: string;
  connectedAt?: string;
}

export interface MeResponse {
  user: User;
  senders: Sender[];
}

export interface ScheduleRequest {
  senderId: string;
  subject: string;
  body: string;
  startTime: string;
  delayMs: number;
  hourlyLimit: number;
  recipients: string[];
}

export interface ScheduleResponse {
  campaignId: string;
  totalEmails: number;
  effectiveDelayMs: number;
  hourlyLimit: number;
}

export interface UploadResponse {
  count: number;
  recipients: string[];
}
