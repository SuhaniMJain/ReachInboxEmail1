import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ExpressAdapter } from "@bull-board/express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import type { BaseAdapter } from "@bull-board/api/dist/src/queueAdapters/base";
import { env } from "./config/env";
import { router } from "./routes";
import { sessionMiddleware, errorHandler, notFoundHandler } from "./middleware/error";
import { requireAuth } from "./middleware/auth";
import { emailQueue } from "./queues/email.queue";

export function createApp(): express.Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true, // session cookie for the SPA
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  app.use(sessionMiddleware);

  // --- Bull Board: real monitoring UI for the actual BullMQ queue ---
  const boardAdapter = new ExpressAdapter();
  boardAdapter.setBasePath("/admin/queues");
  // bullmq's JobProgress type is wider than bull-board's QueueJob; runtime is compatible.
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue) as unknown as BaseAdapter],
    serverAdapter: boardAdapter,
  });
  app.use("/admin/queues", requireAuth, boardAdapter.getRouter());

  app.use(router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
