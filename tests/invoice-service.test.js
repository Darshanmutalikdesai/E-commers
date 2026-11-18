import { describe, expect, it } from "vitest";
import { createInvoicePdf } from "../src/services/invoice.service.js";

describe("order invoice generation", () => {
  it("generates a downloadable PDF with order and totals", async () => {
    const pdf = await createInvoicePdf({
      orderNumber: "ORD-20261117-0123456789AB",
      status: "PENDING",
      paymentMethod: "COD",
      paymentStatus: "PENDING",
      createdAt: new Date("2026-11-17T00:00:00.000Z"),
      shippingAddress: { recipientName: "Test Customer", addressLine1: "12 Example Road" },
      billingAddress: { recipientName: "Test Customer", addressLine1: "12 Example Road" },
      items: [{
        productName: "Test Product",
        variantLabel: null,
        sku: "SKU-1",
        quantity: 2,
        unitPrice: "10.00",
        lineTotal: "20.00",
      }],
      subtotal: "20.00",
      discountTotal: "2.00",
      taxTotal: "1.82",
      shippingFee: "0.00",
      total: "20.00",
      notes: null,
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
