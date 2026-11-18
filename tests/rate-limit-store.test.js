import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    authRateLimitBucket: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));

const { PostgresRateLimitStore } = await import("../src/middleware/postgres-rate-limit-store.js");

describe("PostgreSQL rate-limit store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("increments a shared bucket atomically and returns its reset time", async () => {
    const resetTime = new Date(Date.now() + 60_000);
    prismaMock.$queryRaw.mockResolvedValue([{ hits: 3, resetAt: resetTime }]);
    const store = new PostgresRateLimitStore("login", 60_000);

    const result = await store.increment("127.0.0.1");

    expect(result).toEqual({ totalHits: 3, resetTime });
    expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    expect(store.getKey("127.0.0.1")).not.toContain("127.0.0.1");
  });

  it("does not return expired counters as active limits", async () => {
    prismaMock.authRateLimitBucket.findUnique.mockResolvedValue({
      hits: 2,
      resetAt: new Date(Date.now() - 1_000),
    });
    const store = new PostgresRateLimitStore("login", 60_000);

    await expect(store.get("127.0.0.1")).resolves.toBeUndefined();
  });
});
