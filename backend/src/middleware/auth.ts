import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../utils/errors";
import { getSessionUser, sessionCookieName } from "../services/session.service";
import type { User } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export async function attachUser(req: Request): Promise<User | null> {
  const token = req.cookies?.[sessionCookieName()];
  const user = await getSessionUser(token);
  if (user) req.user = user;
  return user;
}

/** Protects routes: real session cookie from Google OAuth login is required. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new UnauthorizedError("Please sign in with Google to access this resource"));
    return;
  }
  next();
}

export function currentUser(req: Request): User {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}
