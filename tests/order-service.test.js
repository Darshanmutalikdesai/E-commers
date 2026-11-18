import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock, cartHelpers } = vi.hoisted(() => ({
  prismaMock: { $transaction: vi.fn() },
  txMock: {
    $queryRaw: vi.fn(),
    cart: { upsert: vi.fn() },
    cartItem: { findMany: vi.fn(), deleteMany: vi.fn() },
    address: { findFirst: vi.fn() },
    product: { updateMany: vi.fn() },
    productVariant: { updateMany: vi.fn() },
    order: { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    orderStatusHistory: { create: vi.fn() },
    adminActivityLog: { create: vi.fn() },
  },
  cartHelpers: {
    getPurchasableProduct: vi.fn(),
    lockShoppingCart: vi.fn(),
    orderMoneyFromPaise: vi.fn((value) => `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`),
    priceForOrder: vi.fn(),
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/cart.service.js", () => cartHelpers);

const {
  checkoutOrder,
  updateAdminOrderStatus,
  updateAdminPaymentStatus,
} = await import("../src/services/order.service.js");

describe("order lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((operation) => (
      Array.isArray(operation) ? Promise.all(operation) : operation(txMock)
    ));
    txMock.cart.upsert.mockResolvedValue({ id: "cart-id" });
    cartHelpers.lockShoppingCart.mockResolvedValue(undefined);
    txMock.cartItem.findMany.mockResolvedValue([{
      productId: "product-id",
      variantId: null,
      quantity: 2,
    }]);
    txMock.address.findFirst.mockResolvedValue({
      id: "address-id",
      label: "Home",
      recipientName: "Test Customer",
      phone: "+919999999999",
      addressLine1: "12 Example Road",
      addressLine2: null,
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
      country: "IN",
    });
    cartHelpers.getPurchasableProduct.mockResolvedValue({
      product: { id: "product-id", title: "Test Product", sku: "SKU-1", gstRate: 18 },
      variant: null,
    });
    cartHelpers.priceForOrder.mockReturnValue({
      unitPrice: "100.00",
      unitMrp: "120.00",
      lineTotal: "200.00",
      discountAmount: "40.00",
      taxAmount: "30.51",
      subtotalPaise: 20_000,
      discountPaise: 4_000,
      taxPaise: 3_051,
    });
    txMock.product.updateMany.mockResolvedValue({ count: 1 });
    txMock.productVariant.updateMany.mockResolvedValue({ count: 1 });
    txMock.order.create.mockResolvedValue({ id: "order-id" });
    txMock.order.findUnique.mockResolvedValue({ id: "order-id", total: "200.00" });
    txMock.orderStatusHistory.create.mockResolvedValue({});
    txMock.adminActivityLog.create.mockResolvedValue({});
    txMock.cartItem.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("calculates totals from database prices and decrements stock transactionally", async () => {
    const order = await checkoutOrder("customer-id", {
      shippingAddressId: "address-id",
      paymentMethod: "COD",
    });

    expect(cartHelpers.getPurchasableProduct).toHaveBeenCalledWith(
      txMock,
      "product-id",
      null,
    );
    expect(txMock.product.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "product-id", stock: { gte: 2 } }),
      data: { stock: { decrement: 2 } },
    });
    const orderData = txMock.order.create.mock.calls[0][0].data;
    expect(orderData).toMatchObject({
      paymentMethod: "COD",
      subtotal: "200.00",
      discountTotal: "40.00",
      taxTotal: "30.51",
      shippingFee: "0.00",
      total: "200.00",
      shippingAddress: expect.objectContaining({ addressId: "address-id" }),
      billingAddress: expect.objectContaining({ addressId: "address-id" }),
    });
    expect(orderData.items.create[0]).toMatchObject({
      productName: "Test Product",
      sku: "SKU-1",
      unitPrice: "100.00",
      quantity: 2,
    });
    expect(txMock.cartItem.deleteMany).toHaveBeenCalledWith({ where: { cartId: "cart-id" } });
    expect(order).toEqual({ id: "order-id", total: "200.00" });
  });

  it("rejects checkout if stock changed before order creation", async () => {
    txMock.product.updateMany.mockResolvedValue({ count: 0 });

    await expect(checkoutOrder("customer-id", {
      shippingAddressId: "address-id",
      paymentMethod: "COD",
    })).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_STOCK" });
    expect(txMock.order.create).not.toHaveBeenCalled();
    expect(txMock.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects invalid admin status transitions", async () => {
    txMock.order.findUnique.mockResolvedValue({
      id: "order-id",
      status: "PENDING",
      paymentStatus: "PENDING",
      items: [],
    });

    await expect(updateAdminOrderStatus("order-id", "SHIPPED", "admin-id"))
      .rejects.toMatchObject({ statusCode: 409, code: "INVALID_ORDER_STATUS_TRANSITION" });
    expect(txMock.order.update).not.toHaveBeenCalled();
  });

  it("restores variant inventory when an admin marks a return as received", async () => {
    txMock.order.findUnique
      .mockResolvedValueOnce({
        id: "order-id",
        status: "RETURN_REQUESTED",
        paymentStatus: "PAID",
        items: [{ productId: "product-id", variantId: "variant-id", quantity: 2 }],
      })
      .mockResolvedValueOnce({ id: "order-id", status: "RETURNED" });

    await updateAdminOrderStatus("order-id", "RETURNED", "admin-id");

    expect(txMock.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: "variant-id", productId: "product-id" },
      data: { stock: { increment: 2 } },
    });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: "order-id" },
      data: { status: "RETURNED" },
    });
  });

  it("audits manual payment status changes", async () => {
    txMock.order.findUnique
      .mockResolvedValueOnce({
        id: "order-id",
        status: "PENDING",
        paymentStatus: "PENDING",
      })
      .mockResolvedValueOnce({ id: "order-id", paymentStatus: "PAID" });

    await updateAdminPaymentStatus("order-id", "PAID", "admin-id", "Bank transfer received");

    expect(txMock.adminActivityLog.create).toHaveBeenCalledWith({
      data: {
        actorId: "admin-id",
        action: "order.payment_status_updated",
        details: {
          orderId: "order-id",
          fromStatus: "PENDING",
          toStatus: "PAID",
          comment: "Bank transfer received",
        },
      },
    });
  });
});
