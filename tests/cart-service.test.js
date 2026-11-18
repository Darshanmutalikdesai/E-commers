import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    cart: { findUnique: vi.fn() },
  },
  txMock: {
    $queryRaw: vi.fn(),
    cart: { upsert: vi.fn() },
    product: { findFirst: vi.fn() },
    cartItem: { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));
vi.mock("../src/utils/auth-crypto.js", () => ({
  createOpaqueToken: vi.fn(() => "a".repeat(43)),
  hashToken: vi.fn((token) => `hashed:${token}`),
}));

const { addCartItem, priceForOrder } = await import("../src/services/cart.service.js");

describe("shopping cart pricing and writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((operation) => operation(txMock));
    txMock.cart.upsert.mockResolvedValue({ id: "cart-id" });
    txMock.product.findFirst.mockResolvedValue({
      id: "product-id",
      sku: "SKU-1",
      title: "Test Product",
      sellingPrice: 10,
      mrp: 20,
      gstRate: 10,
      stock: 10,
      variants: [],
    });
    txMock.cartItem.findUnique.mockResolvedValue(null);
    txMock.cartItem.count.mockResolvedValue(0);
    txMock.cartItem.upsert.mockResolvedValue({});
    prismaMock.cart.findUnique.mockResolvedValue({
      id: "cart-id",
      items: [{
        id: "item-id",
        productId: "product-id",
        variantId: null,
        quantity: 2,
        product: {
          title: "Test Product",
          sku: "SKU-1",
          isActive: true,
          deletedAt: null,
          sellingPrice: 10,
          mrp: 20,
          gstRate: 10,
          stock: 10,
          category: null,
          variants: [],
        },
        variant: null,
      }],
    });
  });

  it("uses database prices, calculates GST-inclusive tax and discounts, and ignores client totals", async () => {
    const req = {
      auth: { role: "CUSTOMER", userId: "customer-id" },
      get: vi.fn(),
    };
    const cart = await addCartItem(req, {
      productId: "product-id",
      quantity: 2,
      unitPrice: 0,
    });

    expect(txMock.cartItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        productId: "product-id",
        quantity: 2,
        variantKey: "product",
      }),
    }));
    expect(txMock.cartItem.upsert.mock.calls[0][0].create).not.toHaveProperty("unitPrice");
    expect(cart).toMatchObject({
      subtotal: "20.00",
      discountTotal: "20.00",
      taxTotal: "1.82",
      total: "20.00",
      currency: "INR",
      canCheckout: true,
    });
    expect(cart.items[0]).toMatchObject({
      unitPrice: "10.00",
      lineTotal: "20.00",
      taxAmount: "1.82",
      available: true,
    });
  });

  it("calculates variant selling price and MRP snapshots for order items", () => {
    expect(priceForOrder(
      { sellingPrice: 100, mrp: 120, gstRate: 18 },
      { sellingPrice: 90, mrp: 110 },
      2,
    )).toMatchObject({
      unitPrice: "90.00",
      unitMrp: "110.00",
      lineTotal: "180.00",
      discountAmount: "40.00",
      taxAmount: "27.46",
    });
  });

  it("keeps GST calculations precise for large prices and quantities", () => {
    const grossPaise = 999_999_999_999 * 99;
    const expectedTaxPaise = Number(
      (BigInt(grossPaise) * 10_000n + 10_000n) / 20_000n,
    );
    expect(priceForOrder(
      { sellingPrice: 9_999_999_999.99, mrp: 9_999_999_999.99, gstRate: 100 },
      null,
      99,
    ).taxAmount).toBe(`${Math.floor(expectedTaxPaise / 100)}.${String(expectedTaxPaise % 100).padStart(2, "0")}`);
  });

  it("rejects cart additions beyond current stock", async () => {
    txMock.product.findFirst.mockResolvedValue({
      id: "product-id",
      sku: "SKU-1",
      title: "Test Product",
      sellingPrice: 10,
      mrp: 20,
      gstRate: 10,
      stock: 1,
      variants: [],
    });
    const req = {
      auth: { role: "CUSTOMER", userId: "customer-id" },
      get: vi.fn(),
    };

    await expect(addCartItem(req, { productId: "product-id", quantity: 2 }))
      .rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_STOCK" });
    expect(txMock.cartItem.upsert).not.toHaveBeenCalled();
  });
});
