import { env as cloudflareEnvironment } from "cloudflare:workers";
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";
import { env as processEnvironment } from "node:process";

const runtimeEnvironmentKeys = [
  "NODE_ENV",
  "PORT",
  "DATABASE_URL",
  "CORS_ORIGIN",
  "JWT_ACCESS_SECRET",
  "TOKEN_HASH_SECRET",
  "REFRESH_SESSION_DAYS",
  "EMAIL_OTP_MINUTES",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
];

for (const key of runtimeEnvironmentKeys) {
  const value = cloudflareEnvironment[key];
  if (typeof value === "string") processEnvironment[key] = value;
}

const [{ default: app }, { prisma }, { runWithWorkerEnvironment }] = await Promise.all([
  import("./app.js"),
  import("./config/database.js"),
  import("./config/worker-context.js"),
]);
const handler = httpServerHandler(createServer(app));

export default {
  fetch(request, environment, context) {
    return runWithWorkerEnvironment(environment, () => handler.fetch(request, environment, context));
  },

  scheduled(_controller, environment, context) {
    context.waitUntil(runWithWorkerEnvironment(environment, async () => {
      try {
        await prisma.authRateLimitBucket.deleteMany({
          where: { resetAt: { lt: new Date() } },
        });
      } catch (error) {
        console.error("Failed to clean up expired rate-limit buckets", error);
        throw error;
      }
    }));
  },
};
