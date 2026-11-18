import { createHash } from "node:crypto";
import { prisma } from "../config/database.js";

export class PostgresRateLimitStore {
  constructor(prefix, windowMs) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  getKey(key) {
    return createHash("sha256").update(`${this.prefix}:${key}`).digest("hex");
  }

  async get(key) {
    const bucket = await prisma.authRateLimitBucket.findUnique({
      where: { key: this.getKey(key) },
      select: { hits: true, resetAt: true },
    });
    if (!bucket || bucket.resetAt <= new Date()) {
      return undefined;
    }
    return { totalHits: bucket.hits, resetTime: bucket.resetAt };
  }

  async increment(key) {
    const bucketKey = this.getKey(key);
    const resetAt = new Date(Date.now() + this.windowMs);
    const [bucket] = await prisma.$queryRaw`
      INSERT INTO "AuthRateLimitBucket" ("key", "hits", "resetAt")
      VALUES (${bucketKey}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "hits" = CASE
          WHEN "AuthRateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN 1
          ELSE "AuthRateLimitBucket"."hits" + 1
        END,
        "resetAt" = CASE
          WHEN "AuthRateLimitBucket"."resetAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."resetAt"
          ELSE "AuthRateLimitBucket"."resetAt"
        END
      RETURNING "hits", "resetAt"
    `;
    return { totalHits: bucket.hits, resetTime: bucket.resetAt };
  }

  async decrement(key) {
    await prisma.authRateLimitBucket.updateMany({
      where: { key: this.getKey(key), hits: { gt: 0 }, resetAt: { gt: new Date() } },
      data: { hits: { decrement: 1 } },
    });
  }

  async resetKey(key) {
    await prisma.authRateLimitBucket.deleteMany({ where: { key: this.getKey(key) } });
  }

  async resetAll() {
    await prisma.authRateLimitBucket.deleteMany();
  }
}
