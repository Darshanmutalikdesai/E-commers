import { describe, expect, it } from "vitest";
import request from "supertest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-that-is-at-least-thirty-two-characters";
process.env.TOKEN_HASH_SECRET ??= "test-hash-secret-that-is-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";

const { default: app } = await import("../src/app.js");

describe("health endpoints", () => {
  it("reports liveness without requiring a database connection", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.timestamp).toBeTypeOf("string");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("returns a structured 404 for unknown routes", async () => {
    const response = await request(app).get("/missing");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
  });

  it("reports malformed JSON as a client error", async () => {
    const response = await request(app)
      .post("/api/v1/health")
      .set("content-type", "application/json")
      .send("{");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });
});
