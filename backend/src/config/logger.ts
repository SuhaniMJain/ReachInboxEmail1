import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport: process.stdout.isTTY ? { target: "pino-pretty" } : undefined,
});
