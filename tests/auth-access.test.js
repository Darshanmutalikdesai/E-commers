import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-that-is-at-least-thirty-two-characters";
process.env.TOKEN_HASH_SECRET ??= "test-hash-secret-that-is-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
    authSession: { findUnique: vi.fn() },
    rolePermission: { findFirst: vi.fn() },
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));

const { default: app } = await import("../src/app.js");
const { env } = await import("../src/config/env.js");

const userId = "50baf97b-9b78-43ce-8a4c-a7f19112a957";
const sessionId = "dbe60409-04eb-4cbc-8805-b6d1e50a7f61";

function accessToken(role = "CUSTOMER") {
  return jwt.sign(
    { sid: sessionId, role },
    env.JWT_ACCESS_SECRET,
    {
      subject: userId,
      expiresIn: "15m",
      issuer: "single-seller-ecommerce",
      audience: "ecommerce-api",
    },
  );
}

describe("authentication and authorization middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{
      hits: 1,
      resetAt: new Date(Date.now() + 60_000),
    }]);
    prismaMock.authSession.findUnique.mockResolvedValue({
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: userId,
        email: "customer@example.test",
        firstName: "Test",
        lastName: "Customer",
        role: "CUSTOMER",
        isActive: true,
        isEmailVerified: true,
        deletedAt: null,
      },
    });
  });

  it("rejects customer tokens from protected administrative routes", async () => {
    const response = await request(app)
      .get("/api/v1/admin/admins")
      .set("authorization", `Bearer ${accessToken()}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(prismaMock.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("rejects customer tokens from catalog management routes", async () => {
    const response = await request(app)
      .get("/api/v1/admin/products")
      .set("authorization", `Bearer ${accessToken()}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
    expect(prismaMock.rolePermission.findFirst).not.toHaveBeenCalled();
  });

  it("rejects access tokens whose session has been revoked", async () => {
    prismaMock.authSession.findUnique.mockResolvedValueOnce({
      id: sessionId,
      userId,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: userId,
        email: "customer@example.test",
        firstName: "Test",
        lastName: "Customer",
        role: "CUSTOMER",
        isActive: true,
        isEmailVerified: true,
        deletedAt: null,
      },
    });

    const response = await request(app)
      .get("/api/v1/auth/me")
      .set("authorization", `Bearer ${accessToken()}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });

  it("validates login input before accessing authentication services", async () => {
    const response = await request(app)
      .post("/api/v1/admin/auth/login")
      .send({ email: "not-an-email", password: "sensitive-invalid-input" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(response.body)).not.toContain("sensitive-invalid-input");
  });

  it("rejects password-based customer login requests", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: "customer@example.test", password: "legacy-password" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
