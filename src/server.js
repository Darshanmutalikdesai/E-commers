import app from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./config/database.js";

let server;
let rateLimitCleanup;

try {
  await prisma.$connect();
  rateLimitCleanup = setInterval(() => {
    void prisma.authRateLimitBucket.deleteMany({
      where: { resetAt: { lt: new Date() } },
    }).catch((error) => {
      console.error("Failed to clean up expired rate-limit buckets", error);
    });
  }, 6 * 60 * 60 * 1000);
  rateLimitCleanup.unref();

  server = app.listen(env.PORT, () => {
    console.info(`API listening on port ${env.PORT}`);
  });
  server.on("error", (error) => {
    console.error("HTTP server error", error);
    process.exitCode = 1;
    clearInterval(rateLimitCleanup);
    void prisma.$disconnect().catch((disconnectError) => {
      console.error("Failed to disconnect from the database", disconnectError);
      process.exitCode = 1;
    });
  });
} catch (error) {
  console.error("Failed to start the API", error);
  await prisma.$disconnect();
  process.exitCode = 1;
}

if (server) {
  async function shutdown(signal) {
    console.info(`${signal} received; shutting down`);
    clearInterval(rateLimitCleanup);
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      console.error("Failed to close the HTTP server", error);
      process.exitCode = 1;
    } finally {
      try {
        await prisma.$disconnect();
      } catch (error) {
        console.error("Failed to disconnect from the database", error);
        process.exitCode = 1;
      }
    }
  }

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}
