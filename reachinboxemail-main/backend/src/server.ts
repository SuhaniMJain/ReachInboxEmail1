import http from "node:http";
import { env, credentialGaps } from "./config/env";
import { logger } from "./config/logger";
import { createApp } from "./app";
import { createEmailWorker } from "./workers/email.worker";
import { ensureEmailIndex } from "./services/search.service";
import { reconcileOnStartup } from "./services/recovery.service";
import { prisma } from "./config/prisma";
import { redis, bullConnection } from "./config/redis";

async function main(): Promise<void> {
  for (const gap of credentialGaps) {
    logger.warn(`Missing credentials: ${gap} — see README / .env.example before using this integration.`);
  }

  // 1. Elasticsearch index (failure must not block HTTP API startup)
  await ensureEmailIndex().catch((err) => logger.error({ err }, "Elasticsearch unavailable at startup"));

  // 2. Recovery/reconciliation against the DB (source of truth)
  await reconcileOnStartup().catch((err) => logger.error({ err }, "Startup reconciliation failed"));

  // 3. Start the API
  const app = createApp();
  const server = http.createServer(app);
  server.listen(env.PORT, () => {
    logger.info(`API listening on ${env.BACKEND_URL} (Bull Board: ${env.BACKEND_URL}/admin/queues)`);
  });

  // 4. Start the BullMQ worker (concurrency from WORKER_CONCURRENCY)
  const worker = createEmailWorker();
  logger.info({ concurrency: env.WORKER_CONCURRENCY }, "Email worker started");

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close();
    await worker.close();
    await prisma.$disconnect();
    redis.disconnect();
    bullConnection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
