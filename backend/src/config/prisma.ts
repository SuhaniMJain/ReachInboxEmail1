import { PrismaClient } from "@prisma/client";
import { logger } from "./logger";

export const prisma = new PrismaClient({
  log: [{ level: "warn", emit: "event" }, { level: "error", emit: "event" }],
  transactionOptions: { timeout: 20000, maxWait: 5000 },
});

prisma.$on("warn" as never, (e: { message: string }) => logger.warn(e?.message));
prisma.$on("error" as never, (e: { message: string }) => logger.error(e?.message));
