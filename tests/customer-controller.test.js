import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    address: { findFirst: vi.fn() },
  },
  txMock: {
    address: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));

const {
  createCustomerAddress,
  getCustomerAddress,
} = await import("../src/controllers/customer.controller.js");

describe("customer address management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((operation) => operation(txMock));
    txMock.address.findFirst.mockResolvedValue(null);
    txMock.address.updateMany.mockResolvedValue({ count: 0 });
  });

  it("makes the first saved address the customer's default", async () => {
    txMock.address.create.mockImplementation(async ({ data }) => ({ id: "address-id", ...data }));
    const req = {
      auth: { userId: "customer-id" },
      validated: {
        body: {
          recipientName: "Test Customer",
          phone: "+919999999999",
          addressLine1: "12 Example Road",
          city: "Pune",
          state: "Maharashtra",
          postalCode: "411001",
        },
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await createCustomerAddress(req, res);

    expect(txMock.address.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "customer-id",
        country: "IN",
        isDefault: true,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("scopes address lookup to the authenticated customer", async () => {
    prismaMock.address.findFirst.mockResolvedValue(null);
    const req = {
      auth: { userId: "customer-id" },
      validated: { params: { addressId: "address-id" } },
    };
    const res = {};

    await expect(getCustomerAddress(req, res))
      .rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    expect(prismaMock.address.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "address-id", userId: "customer-id" },
    }));
  });
});
