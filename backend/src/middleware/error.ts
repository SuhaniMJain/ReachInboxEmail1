import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { attachUser } from "./auth";
import { HttpError, ValidationError } from "../utils/errors";
import { logger } from "../config/logger";

/** Populate req.user from the session cookie before protected routes run. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    await attachUser(req);
  } catch (err) {
    logger.warn({ err }, "session lookup failed");
  }
  next();
}

export function validate<T>(schema: z.ZodType<T>, source: "body" | "query" | "params") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(new ValidationError("Invalid request payload", result.error.flatten()));
      return;
    }
    Object.assign(req, { [source]: result.data });
    next();
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof z.ZodError) {
    res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request payload", details: err.flatten() },
    });
    return;
  }
  if (err instanceof HttpError) {
    const details = (err as unknown as { details?: unknown }).details;
    res.status(err.status).json({
      error: { code: err.code ?? "ERROR", message: err.message, ...(details ? { details } : {}) },
    });
    return;
  }
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}
