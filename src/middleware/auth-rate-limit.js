import rateLimit from "express-rate-limit";
import { AppError } from "../errors/app-error.js";
import { PostgresRateLimitStore } from "./postgres-rate-limit-store.js";

function limiter(prefix, limit, windowMs) {
  return rateLimit({
    limit,
    windowMs,
    store: new PostgresRateLimitStore(prefix, windowMs),
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res, next) {
      next(new AppError(429, "RATE_LIMITED", "Too many authentication attempts; try again later"));
    },
  });
}

export const loginLimiter = limiter("login", 10, 15 * 60 * 1000);
export const challengeLimiter = limiter("challenge", 5, 15 * 60 * 1000);
export const refreshLimiter = limiter("refresh", 30, 15 * 60 * 1000);
export const sensitiveActionLimiter = limiter("sensitive-action", 10, 15 * 60 * 1000);
