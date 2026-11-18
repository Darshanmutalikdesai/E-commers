import bcrypt from "bcrypt";
import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createOpaqueToken } from "../utils/auth-crypto.js";

const PASSWORD_COST = 12;

function requestMetadata(req) {
  return {
    ipAddress: req.ip?.slice(0, 64) ?? null,
  };
}

export async function listAdmins(req, res) {
  const { page, limit } = req.validated.query;
  const where = {
    role: { in: ["ADMIN", "SUPER_ADMIN"] },
    deletedAt: null,
  };
  const [admins, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  return res.status(200).json({ admins, page, limit, total });
}

export async function createAdmin(req, res) {
  const { email, password, firstName, lastName } = req.validated.body;
  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);

  try {
    const admin = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          role: "ADMIN",
          isEmailVerified: true,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });
      await tx.adminActivityLog.create({
        data: {
          actorId: req.auth.userId,
          targetUserId: created.id,
          action: "admin.created",
          details: { role: "ADMIN" },
          ...requestMetadata(req),
        },
      });
      return created;
    });
    return res.status(201).json({ admin });
  } catch (error) {
    if (error.code === "P2002") {
      throw new AppError(409, "EMAIL_IN_USE", "An account with this email already exists");
    }
    throw error;
  }
}

export async function updateAdminStatus(req, res) {
  const { userId } = req.validated.params;
  const { isActive } = req.validated.body;
  if (userId === req.auth.userId) {
    throw new AppError(400, "CANNOT_CHANGE_OWN_ACCOUNT", "You cannot change your own administrative status");
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, role: "ADMIN", deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!target) {
    throw new AppError(404, "ADMIN_NOT_FOUND", "Administrative account was not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) {
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "ADMIN_DEACTIVATED" },
      });
    }
    await tx.adminActivityLog.create({
      data: {
        actorId: req.auth.userId,
        targetUserId: userId,
        action: isActive ? "admin.activated" : "admin.deactivated",
        details: { previousIsActive: target.isActive, isActive },
        ...requestMetadata(req),
      },
    });
  });
  return res.status(200).json({ id: userId, isActive });
}

export async function deleteAdmin(req, res) {
  const { userId } = req.validated.params;
  if (userId === req.auth.userId) {
    throw new AppError(400, "CANNOT_DELETE_OWN_ACCOUNT", "You cannot delete your own administrative account");
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, role: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!target) {
    throw new AppError(404, "ADMIN_NOT_FOUND", "Administrative account was not found");
  }

  const now = new Date();
  const anonymizedEmail = `deleted-${userId}@deleted.invalid`;
  const passwordHash = await bcrypt.hash(createOpaqueToken(), PASSWORD_COST);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        passwordHash,
        firstName: "Deleted",
        lastName: "Account",
        phone: null,
        isActive: false,
        isEmailVerified: false,
        deletedAt: now,
      },
    });
    await tx.address.deleteMany({ where: { userId } });
    await tx.loginHistory.updateMany({
      where: { userId },
      data: { email: anonymizedEmail },
    });
    await tx.authChallenge.updateMany({
      where: { userId, consumedAt: null },
      data: { consumedAt: now },
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: "ADMIN_DELETED" },
    });
    await tx.adminActivityLog.create({
      data: {
        actorId: req.auth.userId,
        targetUserId: userId,
        action: "admin.deleted",
        ...requestMetadata(req),
      },
    });
  });
  return res.status(204).end();
}

export async function revokeAdminSessions(req, res) {
  const { userId } = req.validated.params;
  const target = await prisma.user.findFirst({
    where: { id: userId, role: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!target) {
    throw new AppError(404, "ADMIN_NOT_FOUND", "Administrative account was not found");
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const revoked = await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokeReason: "REVOKED_BY_SUPER_ADMIN" },
    });
    await tx.adminActivityLog.create({
      data: {
        actorId: req.auth.userId,
        targetUserId: userId,
        action: "admin.sessions_revoked",
        details: { sessionsRevoked: revoked.count },
        ...requestMetadata(req),
      },
    });
    return revoked;
  });
  return res.status(200).json({ revoked: result.count });
}

export async function listCustomers(req, res) {
  const { page, limit, search, isActive, isEmailVerified, createdFrom, createdTo } = req.validated.query;
  const where = {
    role: "CUSTOMER",
    deletedAt: null,
    ...(isActive === undefined ? {} : { isActive }),
    ...(isEmailVerified === undefined ? {} : { isEmailVerified }),
    ...(createdFrom || createdTo
      ? { createdAt: { ...(createdFrom ? { gte: createdFrom } : {}), ...(createdTo ? { lte: createdTo } : {}) } }
      : {}),
    ...(search ? {
      OR: [
        { email: { contains: search, mode: "insensitive" } },
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [customers, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isActive: true,
        isEmailVerified: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);
  return res.status(200).json({ customers, page, limit, total });
}

export async function customerStatistics(req, res) {
  const activeCustomerWhere = { role: "CUSTOMER", deletedAt: null, isActive: true };
  const [total, active, verified, orders] = await prisma.$transaction([
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null } }),
    prisma.user.count({ where: activeCustomerWhere }),
    prisma.user.count({
      where: { role: "CUSTOMER", deletedAt: null, isEmailVerified: true },
    }),
    prisma.order.aggregate({
      _count: { _all: true },
      _sum: { total: true },
    }),
  ]);
  return res.status(200).json({
    customers: {
      total,
      active,
      inactive: total - active,
      emailVerified: verified,
      emailUnverified: total - verified,
    },
    orders: {
      total: orders._count._all,
      grossTotal: orders._sum.total ?? "0",
    },
  });
}

export async function getCustomerDetails(req, res) {
  const { userId } = req.validated.params;
  const customer = await prisma.user.findFirst({
    where: { id: userId, role: "CUSTOMER", deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      isActive: true,
      isEmailVerified: true,
      createdAt: true,
      updatedAt: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          label: true,
          recipientName: true,
          phone: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      _count: { select: { orders: true } },
    },
  });
  if (!customer) {
    throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account was not found");
  }
  return res.status(200).json({ customer });
}

export async function listCustomerOrderHistory(req, res) {
  const { userId } = req.validated.params;
  const { page, limit, status } = req.validated.query;
  const customer = await prisma.user.findFirst({
    where: { id: userId, role: "CUSTOMER", deletedAt: null },
    select: { id: true },
  });
  if (!customer) {
    throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account was not found");
  }

  const where = { userId, ...(status ? { status } : {}) };
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentMethod: true,
        paymentStatus: true,
        subtotal: true,
        discountTotal: true,
        taxTotal: true,
        shippingFee: true,
        total: true,
        shippingAddress: true,
        billingAddress: true,
        createdAt: true,
        statusHistory: {
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { fromStatus: true, toStatus: true, comment: true, createdAt: true },
        },
        items: {
          select: {
            id: true,
            productName: true,
            sku: true,
            unitPrice: true,
            quantity: true,
            lineTotal: true,
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return res.status(200).json({ orders, page, limit, total });
}

export async function updateCustomerStatus(req, res) {
  const { userId } = req.validated.params;
  const { isActive } = req.validated.body;
  const target = await prisma.user.findFirst({
    where: { id: userId, role: "CUSTOMER", deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!target) {
    throw new AppError(404, "CUSTOMER_NOT_FOUND", "Customer account was not found");
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { isActive } });
    if (!isActive) {
      await tx.authSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "CUSTOMER_DEACTIVATED" },
      });
    }
    await tx.adminActivityLog.create({
      data: {
        actorId: req.auth.userId,
        targetUserId: userId,
        action: isActive ? "customer.activated" : "customer.deactivated",
        details: { previousIsActive: target.isActive, isActive },
        ...requestMetadata(req),
      },
    });
  });
  return res.status(200).json({ id: userId, isActive });
}

export async function loginHistory(req, res) {
  const { page, limit, userId } = req.validated.query;
  const where = {
    loginType: "ADMIN",
    ...(userId ? { userId } : {}),
  };
  const [events, total] = await prisma.$transaction([
    prisma.loginHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        email: true,
        role: true,
        successful: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    }),
    prisma.loginHistory.count({ where }),
  ]);
  return res.status(200).json({ events, page, limit, total });
}

export async function activityHistory(req, res) {
  const { page, limit, userId } = req.validated.query;
  const where = userId
    ? { OR: [{ actorId: userId }, { targetUserId: userId }] }
    : {};
  const [events, total] = await prisma.$transaction([
    prisma.adminActivityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        actorId: true,
        targetUserId: true,
        action: true,
        details: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    prisma.adminActivityLog.count({ where }),
  ]);
  return res.status(200).json({ events, page, limit, total });
}
