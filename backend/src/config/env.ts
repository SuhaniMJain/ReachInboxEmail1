import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  BACKEND_URL: z.string().url().default("http://localhost:3001"),
  SESSION_COOKIE_NAME: z.string().default("scheduler_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ELASTICSEARCH_URL: z.string().min(1).default("http://localhost:9200"),
  EMAIL_SEARCH_INDEX: z.string().default("emails"),

  SMTP_HOST: z.string().optional().default(""),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional().default(""),
  SMTP_PASS: z.string().optional().default(""),

  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(""),
  GOOGLE_REDIRECT_URI: z.string().optional().default(""),

  SLACK_CLIENT_ID: z.string().optional().default(""),
  SLACK_CLIENT_SECRET: z.string().optional().default(""),
  SLACK_REDIRECT_URI: z.string().optional().default(""),
  SLACK_BOT_SCOPES: z.string().default("chat:write,im:write"),

  TOKEN_ENCRYPTION_KEY: z.string().min(8).default("dev-only-insecure-key"),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_EMAIL_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
  HOURLY_EMAIL_LIMIT: z.coerce.number().int().positive().default(100),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  MAX_RECIPIENTS_PER_FILE: z.coerce.number().int().positive().default(5000),
  LOG_LEVEL: z.string().default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Warnings for integrations that need real credentials supplied by the developer. */
export const credentialGaps: string[] = [];
if (!env.SMTP_USER || !env.SMTP_PASS) credentialGaps.push("SMTP_USER/SMTP_PASS (Ethereal)");
if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) credentialGaps.push("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET");
if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) credentialGaps.push("SLACK_CLIENT_ID/SLACK_CLIENT_SECRET");
