import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  changePassword,
  deactivateAccount,
  deleteAccount,
  login,
  logoutAllSessions,
  logoutSession,
  registerCustomer,
  requestCustomerLoginOtp,
  requestPasswordReset,
  resendVerification,
  resetPassword,
  rotateRefreshToken,
  verifyCustomerLoginOtp,
  verifyEmail,
} from "../services/auth.service.js";

export async function register(req, res) {
  await registerCustomer(req.validated.body);
  return res.status(202).json({ message: "If the address can receive email, a verification code has been sent" });
}

export async function verifyEmailAddress(req, res) {
  const { email, otp } = req.validated.body;
  await verifyEmail(email, otp);
  return res.status(200).json({ message: "Email address verified" });
}

export async function resendEmailVerification(req, res) {
  await resendVerification(req.validated.body.email);
  return res.status(202).json({ message: "If the address needs verification, a code has been sent" });
}

export function createLoginHandler(loginType) {
  return async (req, res) => {
    const result = await login({
      ...req.validated.body,
      loginType,
      req,
    });
    return res.status(200).json(result);
  };
}

export async function requestCustomerLoginCode(req, res) {
  await requestCustomerLoginOtp(req.validated.body.email);
  return res.status(202).json({
    message: "If the address belongs to an active verified account, a sign-in code has been sent",
  });
}

export async function verifyCustomerLoginCode(req, res) {
  const { email, otp } = req.validated.body;
  const result = await verifyCustomerLoginOtp(email, otp, req);
  return res.status(200).json(result);
}

export function createRefreshHandler(loginType) {
  return async (req, res) => {
    const result = await rotateRefreshToken(req.validated.body.refreshToken, req, loginType);
    return res.status(200).json(result);
  };
}

export async function logout(req, res) {
  await logoutSession(req.auth.userId, req.auth.sessionId);
  return res.status(204).end();
}

export async function logoutEverywhere(req, res) {
  await logoutAllSessions(req.auth.userId);
  return res.status(204).end();
}

export function createForgotPasswordHandler(loginType) {
  return async (req, res) => {
    await requestPasswordReset(req.validated.body.email, loginType);
    return res.status(202).json({ message: "If the account exists, password reset instructions have been sent" });
  };
}

export async function resetPasswordHandler(req, res) {
  const { token, newPassword } = req.validated.body;
  await resetPassword(token, newPassword);
  return res.status(204).end();
}

export async function changePasswordHandler(req, res) {
  const { currentPassword, newPassword } = req.validated.body;
  await changePassword(req.auth.userId, currentPassword, newPassword);
  return res.status(204).end();
}

export function currentProfile(req, res) {
  return res.status(200).json({ user: req.user });
}

export async function updateAdminProfile(req, res) {
  const { firstName, lastName } = req.validated.body;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: req.auth.userId },
      data: { firstName, lastName },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });
    await tx.adminActivityLog.create({
      data: {
        actorId: req.auth.userId,
        targetUserId: req.auth.userId,
        action: "admin.profile_updated",
        ipAddress: req.ip?.slice(0, 64) ?? null,
      },
    });
    return user;
  });
  return res.status(200).json({ user: updated });
}

export async function listSessions(req, res) {
  const sessions = await prisma.authSession.findMany({
    where: {
      userId: req.auth.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { lastUsedAt: "desc" },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });
  return res.status(200).json({
    sessions: sessions.map((session) => ({
      ...session,
      current: session.id === req.auth.sessionId,
    })),
  });
}

export async function revokeSession(req, res) {
  const { count } = await logoutSession(req.auth.userId, req.validated.params.sessionId);
  if (!count) {
    throw new AppError(404, "SESSION_NOT_FOUND", "Active session was not found");
  }
  return res.status(204).end();
}

export async function deactivateSelf(req, res) {
  await deactivateAccount(req.auth.userId);
  return res.status(204).end();
}

export async function deleteSelf(req, res) {
  await deleteAccount(req.auth.userId);
  return res.status(204).end();
}
