import { Client } from "@elastic/elasticsearch";
import type { QueryDslQueryContainer } from "@elastic/elasticsearch/lib/api/types";
import { env } from "../config/env";
import { logger } from "../config/logger";
import type { EmailRecord, EmailStatus } from "@prisma/client";

/**
 * Elasticsearch is used for all email searching. PostgreSQL remains the
 * source of truth — search results are hydrated back from the DB by id.
 */
export const es = new Client({ node: env.ELASTICSEARCH_URL });

const INDEX = env.EMAIL_SEARCH_INDEX;

export interface EmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  senderName: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  messageId: string | null;
  attempts: number;
  lastError: string | null;
}

export async function ensureEmailIndex(): Promise<void> {
  const exists = await es.indices.exists({ index: INDEX });
  if (exists) return;
  await es.indices.create({
    index: INDEX,
    mappings: {
      properties: {
        id: { type: "keyword" },
        userId: { type: "keyword" },
        campaignId: { type: "keyword" },
        senderId: { type: "keyword" },
        senderName: { type: "keyword" },
        senderEmail: { type: "keyword" },
        recipient: { type: "keyword", fields: { text: { type: "text" } } },
        subject: { type: "text" },
        status: { type: "keyword" },
        scheduledAt: { type: "date" },
        sentAt: { type: "date" },
        messageId: { type: "keyword" },
        attempts: { type: "integer" },
        lastError: { type: "text" },
      },
    },
  });
  logger.info(`Elasticsearch index "${INDEX}" created`);
}

export function toEmailDoc(e: EmailRecord & { sender?: { fromName: string; fromEmail: string } | null }): EmailDoc {
  return {
    id: e.id,
    userId: e.userId,
    campaignId: e.campaignId,
    senderId: e.senderId,
    senderName: e.sender?.fromName ?? "",
    senderEmail: e.sender?.fromEmail ?? "",
    recipient: e.recipient,
    subject: e.subject,
    status: e.status,
    scheduledAt: e.scheduledAt.toISOString(),
    sentAt: e.sentAt?.toISOString() ?? null,
    messageId: e.messageId,
    attempts: e.attempts,
    lastError: e.lastError,
  };
}

/** Best-effort indexing: ES failures never break sending, they are logged. */
export async function indexEmails(docs: EmailDoc[]): Promise<void> {
  if (docs.length === 0) return;
  try {
    const operations = docs.flatMap((d) => [{ index: { _index: INDEX, _id: d.id } }, d]);
    await es.bulk({ operations, refresh: "wait_for" });
  } catch (err) {
    logger.error({ err }, "Elasticsearch bulk index failed (DB remains source of truth)");
  }
}

export async function indexEmail(doc: EmailDoc): Promise<void> {
  await indexEmails([doc]);
}

export interface SearchParams {
  userId: string;
  statuses: EmailStatus[];
  query?: string;
  page: number;
  pageSize: number;
  sortDir?: "asc" | "desc";
}

export interface SearchResponse {
  ids: string[];
  total: number;
}

export async function searchEmails(p: SearchParams): Promise<SearchResponse> {
  const must: QueryDslQueryContainer[] = [];
  if (p.query) {
    must.push({
      multi_match: {
        query: p.query,
        fields: ["recipient", "recipient.text", "subject", "senderName", "senderEmail", "messageId"],
      },
    });
  }
  const res = await es.search<EmailDoc>({
    index: INDEX,
    track_total_hits: true,
    query: {
      bool: {
        must,
        filter: [
          { term: { userId: p.userId } }, // tenant isolation at query level
          { terms: { status: p.statuses } },
        ],
      },
    },
    sort: [{ scheduledAt: p.sortDir ?? "desc" }],
    from: (p.page - 1) * p.pageSize,
    size: p.pageSize,
  });
  return {
    ids: res.hits.hits.flatMap((h) => (h._source ? [h._source.id] : [])),
    total: typeof res.hits.total === "number" ? res.hits.total : (res.hits.total?.value ?? 0),
  };
}

export async function esHealth(): Promise<{ up: boolean; detail?: string }> {
  try {
    const res = await es.cluster.health({ timeout: "2s" });
    return { up: res.status !== "red", detail: res.status };
  } catch (err) {
    return { up: false, detail: (err as Error).message };
  }
}
