import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  getPurchasableProduct,
  lockShoppingCart,
  orderMoneyFromPaise,
  priceForOrder,
} from "./cart.service.js";

const returnWindowDays = 7;
const shippingFee = "0.00";

const orderDetailSelect = {
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
  returnReason: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      productId: true,
      variantId: true,
      productName: true,
      sku: true,
      unitPrice: true,
      unitMrp: true,
      quantity: true,
      lineTotal: true,
      discountAmount: true,
      gstRate: true,
      taxAmount: true,
      variantLabel: true,
    },
  },
  statusHistory: {
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      comment: true,
      createdAt: true,
      changedBy: { select: { firstName: true, lastName: true } },
    },
  },
};

function orderNumber() {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  return `ORD-${date}-${suffix}`;
}

function addressSnapshot(address) {
  return {
    addressId: address.id,
    label: address.label,
    recipientName: address.recipientName,
    phone: address.phone,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country,
  };
}

async function lockProduct(tx, productId) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
}

async function decrementInventory(tx, item, product, variant) {
  if (variant) {
    await tx.$queryRaw`SELECT "id" FROM "ProductVariant" WHERE "id" = ${variant.id}::uuid FOR UPDATE`;
    const updated = await tx.productVariant.updateMany({
      where: {
        id: variant.id,
        productId: product.id,
        isActive: true,
        stock: { gte: item.quantity },
      },
      data: { stock: { decrement: item.quantity } },
    });
    if (!updated.count) {
      throw new AppError(409, "INSUFFICIENT_STOCK", "A product variant no longer has the requested stock");
    }
    return;
  }

  const updated = await tx.product.updateMany({
    where: {
      id: product.id,
      isActive: true,
      deletedAt: null,
      stock: { gte: item.quantity },
    },
    data: { stock: { decrement: item.quantity } },
  });
  if (!updated.count) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "A product no longer has the requested stock");
  }
}

export async function checkoutOrder(userId, input) {
  return prisma.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({
      where: { customerId: userId },
      update: {},
      create: { customerId: userId },
      select: { id: true },
    });
    await lockShoppingCart(tx, cart.id);
    const cartItems = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { productId: true, variantId: true, quantity: true },
    });
    if (!cartItems.length) throw new AppError(400, "CART_EMPTY", "Add products to the cart before checkout");

    const shippingAddress = await tx.address.findFirst({
      where: { id: input.shippingAddressId, userId },
    });
    if (!shippingAddress) throw new AppError(400, "INVALID_SHIPPING_ADDRESS", "Select one of your saved addresses");
    const billingAddress = input.billingAddressId
      ? await tx.address.findFirst({ where: { id: input.billingAddressId, userId } })
      : shippingAddress;
    if (!billingAddress) throw new AppError(400, "INVALID_BILLING_ADDRESS", "Select one of your saved addresses");

    for (const productId of [...new Set(cartItems.map((item) => item.productId))].sort()) {
      await lockProduct(tx, productId);
    }

    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    const items = [];
    for (const cartItem of cartItems) {
      const { product, variant } = await getPurchasableProduct(
        tx,
        cartItem.productId,
        cartItem.variantId,
      );
      await decrementInventory(tx, cartItem, product, variant);
      const price = priceForOrder(product, variant, cartItem.quantity);
      subtotal += price.subtotalPaise;
      discountTotal += price.discountPaise;
      taxTotal += price.taxPaise;

      items.push({
        productId: product.id,
        variantId: variant?.id ?? null,
        productName: product.title,
        sku: variant?.sku ?? product.sku,
        unitPrice: price.unitPrice,
        unitMrp: price.unitMrp,
        quantity: cartItem.quantity,
        lineTotal: price.lineTotal,
        discountAmount: price.discountAmount,
        gstRate: String(product.gstRate ?? 0),
        taxAmount: price.taxAmount,
        variantLabel: variant ? [variant.size, variant.color].filter(Boolean).join(" / ") : null,
      });
    }

    const order = await tx.order.create({
      data: {
        orderNumber: orderNumber(),
        userId,
        status: "PENDING",
        paymentMethod: input.paymentMethod,
        paymentStatus: "PENDING",
        subtotal: orderMoneyFromPaise(subtotal),
        discountTotal: orderMoneyFromPaise(discountTotal),
        taxTotal: orderMoneyFromPaise(taxTotal),
        shippingFee,
        total: orderMoneyFromPaise(subtotal),
        shippingAddress: addressSnapshot(shippingAddress),
        billingAddress: addressSnapshot(billingAddress),
        notes: input.notes ?? null,
        items: { create: items },
        statusHistory: {
          create: {
            fromStatus: null,
            toStatus: "PENDING",
            changedByUserId: userId,
            comment: "Order placed",
          },
        },
      },
      select: { id: true },
    });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    return tx.order.findUnique({
      where: { id: order.id },
      select: orderDetailSelect,
    });
  }, { maxWait: 5_000, timeout: 15_000 });
}

export async function listCustomerOrders(userId, { page, limit, status }) {
  const where = { userId, ...(status ? { status } : {}) };
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
        createdAt: true,
        items: {
          select: {
            id: true,
            productName: true,
            sku: true,
            quantity: true,
            lineTotal: true,
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, page, limit, total };
}

export async function getCustomerOrder(userId, orderId) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: orderDetailSelect,
  });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  return order;
}

async function restockOrder(tx, order) {
  const items = [...order.items].sort((left, right) =>
    `${left.variantId ?? left.productId}`.localeCompare(`${right.variantId ?? right.productId}`),
  );
  for (const item of items) {
    if (item.variantId) {
      const restored = await tx.productVariant.updateMany({
        where: { id: item.variantId, productId: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      if (!restored.count) {
        throw new AppError(409, "INVENTORY_RESTOCK_FAILED", "A product variant could not be restocked");
      }
    } else if (item.productId) {
      const restored = await tx.product.updateMany({
        where: { id: item.productId },
        data: { stock: { increment: item.quantity } },
      });
      if (!restored.count) {
        throw new AppError(409, "INVENTORY_RESTOCK_FAILED", "A product could not be restocked");
      }
    } else {
      throw new AppError(409, "INVENTORY_RESTOCK_FAILED", "The original inventory record is no longer available");
    }
  }
}

async function lockOrder(tx, orderId) {
  await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
}

export async function cancelCustomerOrder(userId, orderId, reason) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      select: { id: true, status: true, items: { select: { productId: true, variantId: true, quantity: true } } },
    });
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (!["PENDING", "CONFIRMED", "PROCESSING"].includes(order.status)) {
      throw new AppError(409, "ORDER_CANNOT_BE_CANCELLED", "This order can no longer be cancelled");
    }

    await restockOrder(tx, order);
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED" } });
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: "CANCELLED",
        changedByUserId: userId,
        comment: reason ?? "Cancelled by customer",
      },
    });
    return tx.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  });
}

export async function requestOrderReturn(userId, orderId, reason) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findFirst({
      where: { id: orderId, userId },
      select: {
        id: true,
        status: true,
        updatedAt: true,
        statusHistory: {
          where: { toStatus: "DELIVERED" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    });
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (order.status !== "DELIVERED") {
      throw new AppError(409, "ORDER_NOT_RETURNABLE", "Only delivered orders can be returned");
    }
    const deliveredAt = order.statusHistory[0]?.createdAt ?? order.updatedAt;
    const deadline = deliveredAt.getTime() + returnWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() > deadline) {
      throw new AppError(409, "RETURN_WINDOW_EXPIRED", `Return requests must be made within ${returnWindowDays} days of delivery`);
    }

    await tx.order.update({
      where: { id: orderId },
      data: { status: "RETURN_REQUESTED", returnReason: reason },
    });
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: "DELIVERED",
        toStatus: "RETURN_REQUESTED",
        changedByUserId: userId,
        comment: reason,
      },
    });
    return tx.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  });
}

export async function listAdminOrders({ page, limit, status, paymentStatus, search }) {
  const where = {
    ...(status ? { status } : {}),
    ...(paymentStatus ? { paymentStatus } : {}),
    ...(search
      ? {
          OR: [
            { orderNumber: { contains: search, mode: "insensitive" } },
            { user: { is: { email: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
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
        taxTotal: true,
        shippingFee: true,
        total: true,
        createdAt: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, page, limit, total };
}

export async function getAdminOrder(orderId) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      ...orderDetailSelect,
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
    },
  });
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
  return order;
}

const adminStatusTransitions = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: ["REFUND_PENDING"],
  RETURN_REQUESTED: ["RETURNED", "DELIVERED"],
  RETURNED: ["REFUND_PENDING"],
  REFUND_PENDING: [],
  REFUNDED: [],
};

export async function updateAdminOrderStatus(orderId, status, adminId, comment) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        items: { select: { productId: true, variantId: true, quantity: true } },
      },
    });
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (!adminStatusTransitions[order.status]?.includes(status)) {
      throw new AppError(409, "INVALID_ORDER_STATUS_TRANSITION", `Order cannot move from ${order.status} to ${status}`);
    }
    if (status === "REFUND_PENDING" && order.paymentStatus !== "PAID") {
      throw new AppError(409, "REFUND_NOT_READY", "Only paid orders can enter refund pending");
    }
    if (status === "CANCELLED" || status === "RETURNED") await restockOrder(tx, order);
    await tx.order.update({ where: { id: orderId }, data: { status } });
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: order.status,
        toStatus: status,
        changedByUserId: adminId,
        comment: comment ?? `Order status changed to ${status}`,
      },
    });
    return tx.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  });
}

export async function updateAdminPaymentStatus(orderId, paymentStatus, adminId, comment) {
  return prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Order was not found");
    if (order.paymentStatus === paymentStatus) {
      return tx.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
    }

    if (paymentStatus === "PAID") {
      if (order.paymentStatus !== "PENDING") {
        throw new AppError(409, "INVALID_PAYMENT_STATUS_TRANSITION", "Payment status cannot be changed to PAID");
      }
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "PAID" } });
    } else {
      if (order.paymentStatus !== "PAID" || order.status !== "REFUND_PENDING") {
        throw new AppError(409, "REFUND_NOT_READY", "Only paid orders with a pending refund can be marked refunded");
      }
      await tx.order.update({
        where: { id: orderId },
        data: { paymentStatus: "REFUNDED", status: "REFUNDED" },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: "REFUND_PENDING",
          toStatus: "REFUNDED",
          changedByUserId: adminId,
          comment: comment ?? "Manual refund recorded",
        },
      });
    }
    await tx.adminActivityLog.create({
      data: {
        actorId: adminId,
        action: "order.payment_status_updated",
        details: {
          orderId,
          fromStatus: order.paymentStatus,
          toStatus: paymentStatus,
          comment: comment ?? null,
        },
      },
    });
    return tx.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  });
}
