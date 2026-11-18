import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  createEmailOtp,
  createOpaqueToken,
  hashToken,
  safeHashEquals,
} from "../utils/auth-crypto.js";
import {
  assertEmailConfigured,
  sendLoginCode,
  sendPasswordResetCode,
  sendVerificationCode,
} from "./email.service.js";

const PASSWORD_COST = 12;
const MAX_CHALLENGE_ATTEMPTS = 5;
const refreshExpiry = () => new Date(Date.now() + env.REFRESH_SESSION_DAYS * 24 * 60 * 60 * 1000);
let dummyPasswordHash;

function getDummyPasswordHash() {
  dummyPasswordHash ??= bcrypt.hash(createOpaqueToken(), PASSWORD_COST);
  return dummyPasswordHash;
}

function requestMetadata(req) {
  return {
    ipAddress: req.ip?.slice(0, 64) ?? null,
    userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
  };
}

function signAccessToken(user, sessionId) {
  return jwt.sign(
    { sid: sessionId, role: user.role },
    env.JWT_ACCESS_SECRET,
    {
      algorithm: "HS256",
      subject: user.id,
      expiresIn: "15m",
      issuer: "single-seller-ecommerce",
      audience: "ecommerce-api",
    },
  );
}

function tokenResponse(user, sessionId, refreshToken, expiresAt) {
  return {
    accessToken: signAccessToken(user, sessionId),
    tokenType: "Bearer",
    expiresIn: 900,
    refreshToken,
    refreshExpiresAt: expiresAt,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  };
}

async function revokeUserSessions(tx, userId, reason, now = new Date()) {
  return tx.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now, revokeReason: reason },
  });
}

async function createSessionInTransaction(tx, user, loginType, req) {
  const rawToken = createOpaqueToken();
  const expiresAt = refreshExpiry();
  const metadata = requestMetadata(req);

  const session = await tx.authSession.create({
    data: {
      userId: user.id,
      userAgent: metadata.userAgent,
      ipAddress: metadata.ipAddress,
      expiresAt,
    },
  });

  await tx.refreshToken.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      tokenHash: hashToken(rawToken, "refresh-token"),
      expiresAt,
    },
  });

  await tx.loginHistory.create({
    data: {
      userId: user.id,
      email: user.email,
      role: user.role,
      loginType,
      successful: true,
      ...metadata,
    },
  });

  return { session, rawToken, expiresAt };
}

async function createSession(user, loginType, req) {
  const issued = await prisma.$transaction((tx) =>
    createSessionInTransaction(tx, user, loginType, req));
  return tokenResponse(user, issued.session.id, issued.rawToken, issued.expiresAt);
}

async function recordLoginAttempt(user, email, loginType, req) {
  const metadata = requestMetadata(req);
  await prisma.loginHistory.create({
    data: {
      userId: user?.id ?? null,
      email,
      role: user?.role ?? null,
      loginType,
      successful: false,
      ...metadata,
    },
  });
}

async function replaceChallenge(userId, type, rawToken, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  return prisma.$transaction(async (tx) => {
    const latest = await tx.authChallenge.findFirst({
      where: { userId, type },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (latest && now.getTime() - latest.createdAt.getTime() < 60_000) {
      throw new AppError(429, "RATE_LIMITED", "Wait before requesting another email code");
    }

    await tx.authChallenge.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: now },
    });
    return tx.authChallenge.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(rawToken, type),
        expiresAt,
      },
    });
  });
}

async function sendChallengeEmail(user, challenge, deliver) {
  try {
    await deliver(user.email, challenge.rawToken);
  } catch (error) {
    await prisma.authChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    throw error;
  }
}

async function issueEmailVerification(user) {
  const otp = createEmailOtp();
  const challenge = await replaceChallenge(
    user.id,
    "EMAIL_VERIFICATION",
    otp,
    env.EMAIL_OTP_MINUTES * 60 * 1000,
  );
  await sendChallengeEmail(
    user,
    { ...challenge, rawToken: otp },
    sendVerificationCode,
  );
}

async function issueLoginCode(user) {
  const otp = createEmailOtp();
  const challenge = await replaceChallenge(
    user.id,
    "LOGIN_OTP",
    otp,
    env.EMAIL_OTP_MINUTES * 60 * 1000,
  );
  await sendChallengeEmail(user, { ...challenge, rawToken: otp }, sendLoginCode);
}

export async function registerCustomer(input) {
  assertEmailConfigured();
  let user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          email: input.email,
          firstName: input.firstName ?? "Customer",
          lastName: input.lastName ?? "",
          role: "CUSTOMER",
        },
      });
    } catch (error) {
      if (error.code === "P2002") {
        return;
      }
      throw error;
    }
  }

  if (
    user.role === "CUSTOMER" &&
    user.isActive &&
    !user.isEmailVerified &&
    !user.deletedAt
  ) {
    await issueEmailVerification(user);
  }
}

export async function requestCustomerLoginOtp(email) {
  assertEmailConfigured();
  const user = await prisma.user.findUnique({ where: { email } });
  if (
    user?.role === "CUSTOMER" &&
    user.isActive &&
    user.isEmailVerified &&
    !user.deletedAt
  ) {
    await issueLoginCode(user);
  }
}

export async function verifyCustomerLoginOtp(email, otp, req) {
  const user = await prisma.user.findUnique({ where: { email } });
  const now = new Date();
  const eligible = user?.role === "CUSTOMER" &&
    user.isActive &&
    user.isEmailVerified &&
    !user.deletedAt;
  const challenge = eligible
    ? await prisma.authChallenge.findFirst({
      where: {
        userId: user.id,
        type: "LOGIN_OTP",
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
      },
      orderBy: { createdAt: "desc" },
    })
    : null;
  const valid = challenge && safeHashEquals(
    challenge.tokenHash,
    hashToken(otp, "LOGIN_OTP"),
  );

  if (!valid) {
    if (challenge) {
      const attempts = challenge.attempts + 1;
      await prisma.authChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: {
          attempts: { increment: 1 },
          ...(attempts >= MAX_CHALLENGE_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
    }
    await recordLoginAttempt(user, email, "CUSTOMER", req);
    throw new AppError(401, "INVALID_LOGIN_CODE", "Sign-in code is invalid or expired");
  }

  const issued = await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AppError(401, "INVALID_LOGIN_CODE", "Sign-in code is invalid or expired");
    }

    return createSessionInTransaction(tx, user, "CUSTOMER", req);
  });

  return tokenResponse(user, issued.session.id, issued.rawToken, issued.expiresAt);
}

export async function resendVerification(email) {
  assertEmailConfigured();
  const user = await prisma.user.findUnique({ where: { email } });
  if (
    user?.role === "CUSTOMER" &&
    user.isActive &&
    !user.isEmailVerified &&
    !user.deletedAt
  ) {
    await issueEmailVerification(user);
  }
}

export async function verifyEmail(email, otp) {
  const user = await prisma.user.findUnique({ where: { email } });
  const now = new Date();
  if (!user || user.role !== "CUSTOMER" || user.deletedAt || user.isEmailVerified) {
    throw new AppError(400, "INVALID_VERIFICATION_CODE", "Verification code is invalid or expired");
  }

  const challenge = await prisma.authChallenge.findFirst({
    where: {
      userId: user.id,
      type: "EMAIL_VERIFICATION",
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
    },
    orderBy: { createdAt: "desc" },
  });

  const valid = challenge && safeHashEquals(
    challenge.tokenHash,
    hashToken(otp, "EMAIL_VERIFICATION"),
  );

  if (!valid) {
    if (challenge) {
      const attempts = challenge.attempts + 1;
      await prisma.authChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: {
          attempts: { increment: 1 },
          ...(attempts >= MAX_CHALLENGE_ATTEMPTS ? { consumedAt: now } : {}),
        },
      });
    }
    throw new AppError(400, "INVALID_VERIFICATION_CODE", "Verification code is invalid or expired");
  }

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
      },
      data: { consumedAt: now },
    });

    if (consumed.count !== 1) {
      throw new AppError(400, "INVALID_VERIFICATION_CODE", "Verification code is invalid or expired");
    }

    await tx.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true },
    });
  });
}

export async function login({ email, password, loginType, req }) {
  const user = await prisma.user.findUnique({ where: { email } });
  const acceptedRoles = loginType === "ADMIN" ? ["ADMIN", "SUPER_ADMIN"] : [];
  const roleAllowed = user && acceptedRoles.includes(user.role);
  const passwordMatches = await bcrypt.compare(
    password,
    roleAllowed ? user.passwordHash : await getDummyPasswordHash(),
  );

  if (
    !user ||
    !roleAllowed ||
    !passwordMatches ||
    !user.isActive ||
    user.deletedAt
  ) {
    await recordLoginAttempt(user, email, loginType, req);
    throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
  }

  if (loginType === "CUSTOMER" && !user.isEmailVerified) {
    await recordLoginAttempt(user, email, loginType, req);
    throw new AppError(403, "EMAIL_NOT_VERIFIED", "Verify your email address before signing in");
  }

  return createSession(user, loginType, req);
}

export async function rotateRefreshToken(rawToken, req, loginType) {
  const tokenHash = hashToken(rawToken, "refresh-token");
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { session: true, user: true },
  });
  const now = new Date();

  if (!record) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }

  const roleAllowed = loginType === "CUSTOMER"
    ? record.user.role === "CUSTOMER"
    : record.user.role === "ADMIN" || record.user.role === "SUPER_ADMIN";
  if (!roleAllowed) {
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }

  if (record.revokedAt || record.session?.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await revokeUserSessions(tx, record.userId, "REFRESH_TOKEN_REUSE", now);
      if (record.user.role !== "CUSTOMER") {
        await tx.adminActivityLog.create({
          data: {
            actorId: record.userId,
            targetUserId: record.userId,
            action: "auth.refresh_token_reuse",
            ...requestMetadata(req),
          },
        });
      }
    });
    throw new AppError(401, "REFRESH_TOKEN_REUSE", "Refresh token reuse detected; all sessions were revoked");
  }

  if (
    !record.session ||
    record.expiresAt <= now ||
    record.session.expiresAt <= now ||
    !record.user.isActive ||
    record.user.deletedAt
  ) {
    if (record.session) {
      await prisma.authSession.updateMany({
        where: { id: record.session.id, revokedAt: null },
        data: { revokedAt: now, revokeReason: "EXPIRED_OR_INACTIVE" },
      });
    }
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
  }

  const nextToken = createOpaqueToken();
  const nextTokenId = randomUUID();
  const rotation = await prisma.$transaction(async (tx) => {
    const claimed = await tx.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now, replacedByTokenId: nextTokenId },
    });

    if (claimed.count !== 1) {
      await revokeUserSessions(tx, record.userId, "REFRESH_TOKEN_REUSE", now);
      if (record.user.role !== "CUSTOMER") {
        await tx.adminActivityLog.create({
          data: {
            actorId: record.userId,
            targetUserId: record.userId,
            action: "auth.refresh_token_reuse",
            ...requestMetadata(req),
          },
        });
      }
      return { reused: true };
    }

    const activeSession = await tx.authSession.updateMany({
      where: {
        id: record.session.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { lastUsedAt: now },
    });
    if (activeSession.count !== 1) {
      throw new AppError(401, "INVALID_REFRESH_TOKEN", "Session is no longer active");
    }

    await tx.refreshToken.create({
      data: {
        id: nextTokenId,
        userId: record.userId,
        sessionId: record.session.id,
        tokenHash: hashToken(nextToken, "refresh-token"),
        expiresAt: record.session.expiresAt,
      },
    });

    return { reused: false };
  });

  if (rotation.reused) {
    throw new AppError(401, "REFRESH_TOKEN_REUSE", "Refresh token reuse detected; all sessions were revoked");
  }

  return tokenResponse(record.user, record.session.id, nextToken, record.session.expiresAt);
}

export async function logoutSession(userId, sessionId) {
  return prisma.authSession.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "LOGOUT" },
  });
}

export async function logoutAllSessions(userId, reason = "LOGOUT_ALL") {
  return prisma.$transaction((tx) => revokeUserSessions(tx, userId, reason));
}

export async function requestPasswordReset(email, loginType) {
  assertEmailConfigured();
  const user = await prisma.user.findUnique({ where: { email } });
  const roleAllowed = loginType === "ADMIN" &&
    (user?.role === "ADMIN" || user?.role === "SUPER_ADMIN");
  if (!user || !roleAllowed || !user.isActive || user.deletedAt) {
    return;
  }

  const resetToken = createOpaqueToken();
  const challenge = await replaceChallenge(
    user.id,
    "PASSWORD_RESET",
    resetToken,
    30 * 60 * 1000,
  );
  await sendChallengeEmail(user, { ...challenge, rawToken: resetToken }, sendPasswordResetCode);
}

export async function resetPassword(rawToken, newPassword) {
  const now = new Date();
  const challenge = await prisma.authChallenge.findFirst({
    where: {
      tokenHash: hashToken(rawToken, "PASSWORD_RESET"),
      type: "PASSWORD_RESET",
      consumedAt: null,
      expiresAt: { gt: now },
      attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
    },
    include: { user: true },
  });

  if (
    !challenge ||
    (challenge.user.role !== "ADMIN" && challenge.user.role !== "SUPER_ADMIN") ||
    !challenge.user.isActive ||
    challenge.user.deletedAt
  ) {
    throw new AppError(400, "INVALID_RESET_TOKEN", "Password reset token is invalid or expired");
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_COST);
  await prisma.$transaction(async (tx) => {
    const consumed = await tx.authChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) {
      throw new AppError(400, "INVALID_RESET_TOKEN", "Password reset token is invalid or expired");
    }

    await tx.user.update({
      where: { id: challenge.userId },
      data: { passwordHash },
    });
    await revokeUserSessions(tx, challenge.userId, "PASSWORD_RESET", now);
    await tx.authChallenge.updateMany({
      where: {
        userId: challenge.userId,
        type: "PASSWORD_RESET",
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
  });
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, "INVALID_CURRENT_PASSWORD", "Current password is incorrect");
  }

  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_COST);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await revokeUserSessions(tx, userId, "PASSWORD_CHANGED");
    await tx.authChallenge.updateMany({
      where: { userId, type: "PASSWORD_RESET", consumedAt: null },
      data: { consumedAt: new Date() },
    });
  });
}

export async function deactivateAccount(userId) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive: false } });
    await revokeUserSessions(tx, userId, "ACCOUNT_DEACTIVATED", now);
  });
}

export async function deleteAccount(userId) {
  const now = new Date();
  const anonymizedEmail = `deleted-${userId}@deleted.invalid`;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        passwordHash: null,
        firstName: "Deleted",
        lastName: "Account",
        phone: null,
        isActive: false,
        isEmailVerified: false,
        deletedAt: now,
      },
    });
    await tx.address.deleteMany({ where: { userId } });
    await tx.cart.deleteMany({ where: { customerId: userId } });
    await tx.wishlistItem.deleteMany({ where: { userId } });
    await tx.order.updateMany({
      where: { userId },
      data: {
        shippingAddress: { redacted: true },
        billingAddress: { redacted: true },
        notes: null,
        returnReason: null,
      },
    });
    await tx.orderStatusHistory.updateMany({
      where: { changedByUserId: userId },
      data: { comment: null },
    });
    await tx.loginHistory.updateMany({
      where: { userId },
      data: { email: anonymizedEmail },
    });
    await tx.authChallenge.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await revokeUserSessions(tx, userId, "ACCOUNT_DELETED", now);
  });
}
