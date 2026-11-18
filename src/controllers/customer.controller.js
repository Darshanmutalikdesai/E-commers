import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";

const addressSelect = {
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
};

export async function updateCustomerProfile(req, res) {
  const user = await prisma.user.update({
    where: { id: req.auth.userId },
    data: req.validated.body,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      role: true,
      isEmailVerified: true,
    },
  });
  return res.status(200).json({ user });
}

export async function listCustomerAddresses(req, res) {
  const addresses = await prisma.address.findMany({
    where: { userId: req.auth.userId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    select: addressSelect,
  });
  return res.status(200).json({ addresses });
}

export async function getCustomerAddress(req, res) {
  const address = await prisma.address.findFirst({
    where: { id: req.validated.params.addressId, userId: req.auth.userId },
    select: addressSelect,
  });
  if (!address) throw new AppError(404, "ADDRESS_NOT_FOUND", "Address was not found");
  return res.status(200).json({ address });
}

export async function createCustomerAddress(req, res) {
  const input = req.validated.body;
  const address = await prisma.$transaction(async (tx) => {
    const existingDefault = await tx.address.findFirst({
      where: { userId: req.auth.userId, isDefault: true },
      select: { id: true },
    });
    const isDefault = input.isDefault ?? !existingDefault;
    if (isDefault) {
      await tx.address.updateMany({
        where: { userId: req.auth.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.create({
      data: { ...input, country: input.country ?? "IN", userId: req.auth.userId, isDefault },
      select: addressSelect,
    });
  });
  return res.status(201).json({ address });
}

export async function updateCustomerAddress(req, res) {
  const { addressId } = req.validated.params;
  const input = req.validated.body;
  const address = await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id: addressId, userId: req.auth.userId },
      select: { id: true, isDefault: true },
    });
    if (!existing) {
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address was not found");
    }

    if (input.isDefault === true) {
      await tx.address.updateMany({
        where: { userId: req.auth.userId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const updated = await tx.address.update({
      where: { id: addressId },
      data: input,
      select: addressSelect,
    });

    if (input.isDefault === false && existing.isDefault) {
      const nextDefault = await tx.address.findFirst({
        where: { userId: req.auth.userId, id: { not: addressId } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (nextDefault) {
        await tx.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }

    return updated;
  });
  return res.status(200).json({ address });
}

export async function deleteCustomerAddress(req, res) {
  const { addressId } = req.validated.params;
  await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id: addressId, userId: req.auth.userId },
      select: { id: true, isDefault: true },
    });
    if (!existing) {
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address was not found");
    }

    await tx.address.delete({ where: { id: addressId } });
    if (existing.isDefault) {
      const nextDefault = await tx.address.findFirst({
        where: { userId: req.auth.userId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (nextDefault) {
        await tx.address.update({
          where: { id: nextDefault.id },
          data: { isDefault: true },
        });
      }
    }
  });
  return res.status(204).end();
}

export async function setCustomerDefaultAddress(req, res) {
  const { addressId } = req.validated.params;
  const address = await prisma.$transaction(async (tx) => {
    const existing = await tx.address.findFirst({
      where: { id: addressId, userId: req.auth.userId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError(404, "ADDRESS_NOT_FOUND", "Address was not found");
    }

    await tx.address.updateMany({
      where: { userId: req.auth.userId, isDefault: true },
      data: { isDefault: false },
    });
    return tx.address.update({
      where: { id: addressId },
      data: { isDefault: true },
      select: addressSelect,
    });
  });
  return res.status(200).json({ address });
}

export async function listCustomerOrders(req, res) {
  const { page, limit, status } = req.validated.query;
  const where = {
    userId: req.auth.userId,
    ...(status ? { status } : {}),
  };
  const [orders, total] = await prisma.$transaction([
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
