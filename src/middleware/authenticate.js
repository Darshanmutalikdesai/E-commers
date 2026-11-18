import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";

export async function authenticate(req, res, next) {
  const authorization = req.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return next(new AppError(401, "UNAUTHORIZED", "Authentication is required"));
  }

  let claims;
  try {
    claims = jwt.verify(match[1], env.JWT_ACCESS_SECRET, {
      algorithms: ["HS256"],
      issuer: "single-seller-ecommerce",
      audience: "ecommerce-api",
    });
  } catch {
    return next(new AppError(401, "UNAUTHORIZED", "Access token is invalid or expired"));
  }

  if (
    typeof claims === "string" ||
    typeof claims.sub !== "string" ||
    typeof claims.sid !== "string"
  ) {
    return next(new AppError(401, "UNAUTHORIZED", "Access token is invalid or expired"));
  }

  try {
    const session = await prisma.authSession.findUnique({
      where: { id: claims.sid },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            isActive: true,
            isEmailVerified: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !session ||
      session.userId !== claims.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive ||
      session.user.deletedAt ||
      (session.user.role === "CUSTOMER" && !session.user.isEmailVerified)
    ) {
      return next(new AppError(401, "UNAUTHORIZED", "Session is no longer active"));
    }

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
      role: session.user.role,
    };
    req.user = session.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(new AppError(403, "FORBIDDEN", "You do not have access to this resource"));
    }
    return next();
  };
}

export function optionalCustomerAuth(req, res, next) {
  if (!req.get("authorization")) return next();
  return authenticate(req, res, (error) => {
    if (error) return next(error);
    return requireRoles("CUSTOMER")(req, res, next);
  });
}

export function requirePermission(permissionKey) {
  return async (req, res, next) => {
    if (!req.auth) {
      return next(new AppError(401, "UNAUTHORIZED", "Authentication is required"));
    }

    try {
      const permission = await prisma.rolePermission.findFirst({
        where: {
          role: req.auth.role,
          permission: { key: permissionKey },
        },
        select: { role: true },
      });

      if (!permission) {
        return next(new AppError(403, "FORBIDDEN", "You do not have permission for this action"));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}
