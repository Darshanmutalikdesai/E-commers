import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";

export function health(req, res) {
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}

export async function readiness(req, res, next) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: "ready" });
  } catch (error) {
    console.error("Database readiness check failed", error);
    return next(new AppError(503, "SERVICE_UNAVAILABLE", "Database is not available"));
  }
}
