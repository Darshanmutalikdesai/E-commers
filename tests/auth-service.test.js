import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-that-is-at-least-thirty-two-characters";
process.env.TOKEN_HASH_SECRET ??= "test-hash-secret-that-is-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";

const { emailMock, prismaMock, txMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    authChallenge: { findFirst: vi.fn(), updateMany: vi.fn() },
    refreshToken: { findUnique: vi.fn() },
    loginHistory: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  txMock: {
    user: { update: vi.fn() },
    authChallenge: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    authSession: { create: vi.fn(), updateMany: vi.fn() },
    refreshToken: { updateMany: vi.fn(), create: vi.fn() },
    loginHistory: { create: vi.fn(), updateMany: vi.fn() },
    adminActivityLog: { create: vi.fn() },
    address: { deleteMany: vi.fn() },
    cart: { deleteMany: vi.fn() },
    wishlistItem: { deleteMany: vi.fn() },
    order: { updateMany: vi.fn() },
    orderStatusHistory: { updateMany: vi.fn() },
  },
  emailMock: {
    assertEmailConfigured: vi.fn(),
    sendLoginCode: vi.fn(),
    sendVerificationCode: vi.fn(),
    sendPasswordResetCode: vi.fn(),
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/email.service.js", () => emailMock);

const {
  registerCustomer,
  requestCustomerLoginOtp,
  rotateRefreshToken,
  verifyCustomerLoginOtp,
  deleteAccount,
} = await import("../src/services/auth.service.js");
const { hashToken } = await import("../src/utils/auth-crypto.js");

const userId = "50baf97b-9b78-43ce-8a4c-a7f19112a957";
const sessionId = "dbe60409-04eb-4cbc-8805-b6d1e50a7f61";
const refreshToken = "a".repeat(43);

function refreshRecord(overrides = {}) {
  return {
    id: "c4978f88-3981-43ba-9d6e-c414c5b27dd0",
    userId,
    tokenHash: "0".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    sessionId,
    session: {
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    },
    user: {
      id: userId,
      email: "customer@example.test",
      firstName: "Test",
      lastName: "Customer",
      role: "CUSTOMER",
      isActive: true,
      deletedAt: null,
    },
    ...overrides,
  };
}

describe("refresh token rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((operation) => operation(txMock));
    txMock.authChallenge.findFirst.mockResolvedValue(null);
    txMock.authChallenge.create.mockResolvedValue({
      id: "challenge-id",
      createdAt: new Date(),
    });
    txMock.authChallenge.updateMany.mockResolvedValue({ count: 1 });
    txMock.authSession.create.mockResolvedValue({ id: sessionId });
    txMock.authSession.updateMany.mockResolvedValue({ count: 1 });
    txMock.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    txMock.refreshToken.create.mockResolvedValue({});
    txMock.loginHistory.create.mockResolvedValue({});
    txMock.adminActivityLog.create.mockResolvedValue({});
  });

  it("revokes all active sessions when a rotated token is reused", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(
      refreshRecord({ revokedAt: new Date(Date.now() - 1_000) }),
    );

    await expect(rotateRefreshToken(refreshToken, { ip: "127.0.0.1" }, "CUSTOMER"))
      .rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSE" });

    expect(txMock.authSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId, revokedAt: null },
      data: expect.objectContaining({ revokeReason: "REFRESH_TOKEN_REUSE" }),
    }));
    expect(txMock.refreshToken.create).not.toHaveBeenCalled();
  });

  it("does not allow a customer refresh token on the admin refresh endpoint", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRecord());

    await expect(rotateRefreshToken(refreshToken, {}, "ADMIN"))
      .rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("replaces a valid refresh token and issues a new access token", async () => {
    prismaMock.refreshToken.findUnique.mockResolvedValue(refreshRecord());

    const response = await rotateRefreshToken(refreshToken, { ip: "127.0.0.1" }, "CUSTOMER");

    expect(response.accessToken).toBeTypeOf("string");
    expect(response.refreshToken).not.toBe(refreshToken);
    expect(txMock.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "c4978f88-3981-43ba-9d6e-c414c5b27dd0" }),
    }));
    expect(txMock.refreshToken.create).toHaveBeenCalledOnce();
  });

  it("sends a sign-in OTP only to an active, verified customer", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: userId,
      email: "customer@example.test",
      role: "CUSTOMER",
      isActive: true,
      isEmailVerified: true,
      deletedAt: null,
    });

    await requestCustomerLoginOtp("customer@example.test");

    expect(emailMock.sendLoginCode).toHaveBeenCalledWith(
      "customer@example.test",
      expect.stringMatching(/^\d{6}$/),
    );
    expect(txMock.authChallenge.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "LOGIN_OTP" }),
    }));
  });

  it("removes account-specific shopping data and redacts customer order details", async () => {
    await deleteAccount(userId);

    expect(txMock.cart.deleteMany).toHaveBeenCalledWith({ where: { customerId: userId } });
    expect(txMock.wishlistItem.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(txMock.order.updateMany).toHaveBeenCalledWith({
      where: { userId },
      data: {
        shippingAddress: { redacted: true },
        billingAddress: { redacted: true },
        notes: null,
        returnReason: null,
      },
    });
    expect(txMock.orderStatusHistory.updateMany).toHaveBeenCalledWith({
      where: { changedByUserId: userId },
      data: { comment: null },
    });
  });

  it("registers without a password and emails an address-verification OTP", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: userId,
      email: "customer@example.test",
      role: "CUSTOMER",
      isActive: true,
      isEmailVerified: false,
      deletedAt: null,
    });

    await registerCustomer({ email: "customer@example.test" });

    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: {
        email: "customer@example.test",
        firstName: "Customer",
        lastName: "",
        role: "CUSTOMER",
      },
    });
    expect(emailMock.sendVerificationCode).toHaveBeenCalledWith(
      "customer@example.test",
      expect.stringMatching(/^\d{6}$/),
    );
  });

  it("does not send a sign-in OTP to an unverified customer", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: userId,
      email: "customer@example.test",
      role: "CUSTOMER",
      isActive: true,
      isEmailVerified: false,
      deletedAt: null,
    });

    await requestCustomerLoginOtp("customer@example.test");

    expect(emailMock.sendLoginCode).not.toHaveBeenCalled();
    expect(txMock.authChallenge.create).not.toHaveBeenCalled();
  });

  it("consumes a valid sign-in OTP and creates a customer session", async () => {
    const otp = "123456";
    prismaMock.user.findUnique.mockResolvedValue({
      id: userId,
      email: "customer@example.test",
      firstName: "Test",
      lastName: "Customer",
      role: "CUSTOMER",
      isActive: true,
      isEmailVerified: true,
      deletedAt: null,
    });
    prismaMock.authChallenge.findFirst.mockResolvedValue({
      id: "challenge-id",
      tokenHash: hashToken(otp, "LOGIN_OTP"),
      attempts: 0,
    });

    const response = await verifyCustomerLoginOtp(
      "customer@example.test",
      otp,
      { ip: "127.0.0.1", get: () => undefined },
    );

    expect(response.accessToken).toBeTypeOf("string");
    expect(response.refreshToken).toBeTypeOf("string");
    expect(txMock.authChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "challenge-id", consumedAt: null }),
    }));
    expect(txMock.authSession.create).toHaveBeenCalledOnce();
    expect(txMock.loginHistory.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ loginType: "CUSTOMER", successful: true }),
    }));
  });
});
