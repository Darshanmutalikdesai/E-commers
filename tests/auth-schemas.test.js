import { describe, expect, it } from "vitest";
import {
  addressIdSchema,
  cartItemWriteSchema,
  categoryWriteSchema,
  checkoutSchema,
  customerLoginOtpSchema,
  createAddressSchema,
  emailOtpSchema,
  productCreateSchema,
  productImageOrderSchema,
  productUpdateSchema,
  productImageUpdateSchema,
  registerSchema,
  updateAddressSchema,
} from "../src/validation/auth.schemas.js";

describe("passwordless customer authentication schemas", () => {
  it("accepts email-only registration without a customer password", () => {
    expect(registerSchema.safeParse({
      body: { email: "customer@example.test" },
    }).success).toBe(true);

    expect(registerSchema.safeParse({
      body: { email: "customer@example.test", password: "not-allowed" },
    }).success).toBe(false);
  });

  it("uses email to request and verify a customer sign-in code", () => {
    expect(customerLoginOtpSchema.safeParse({
      body: { email: "customer@example.test" },
    }).success).toBe(true);
    expect(emailOtpSchema.safeParse({
      body: { email: "customer@example.test", otp: "123456" },
    }).success).toBe(true);
  });

  it("validates delivery addresses and refuses empty address updates", () => {
    const address = {
      recipientName: "Test Customer",
      phone: "+919999999999",
      addressLine1: "12 Example Road",
      city: "Pune",
      state: "Maharashtra",
      postalCode: "411001",
    };
    expect(createAddressSchema.safeParse({ body: address }).success).toBe(true);
    expect(updateAddressSchema.safeParse({
      params: { addressId: "50baf97b-9b78-43ce-8a4c-a7f19112a957" },
      body: {},
    }).success).toBe(false);
    expect(addressIdSchema.safeParse({
      params: { addressId: "not-a-uuid" },
    }).success).toBe(false);
  });

  it("validates product prices, variant identifiers, and category slugs", () => {
    const product = {
      sku: "TSHIRT-001",
      title: "Test T-shirt",
      slug: "test-t-shirt",
      sellingPrice: 20,
      mrp: 25,
      variants: [{ sku: "TSHIRT-001-M-RED", size: "M", color: "Red" }],
    };
    expect(productCreateSchema.safeParse({ body: product }).success).toBe(true);
    expect(productCreateSchema.safeParse({
      body: { ...product, mrp: 10 },
    }).success).toBe(false);
    expect(productUpdateSchema.safeParse({
      params: { productId: "50baf97b-9b78-43ce-8a4c-a7f19112a957" },
      body: {},
    }).success).toBe(false);
    expect(categoryWriteSchema.safeParse({
      body: { name: "Clothing", slug: "invalid slug" },
    }).success).toBe(false);
  });

  it("requires a complete unique image order and validates optional image alt text", () => {
    const productId = "50baf97b-9b78-43ce-8a4c-a7f19112a957";
    const firstImageId = "f28238a7-a6ca-49b0-8d74-07c9cf5b9c9a";
    const secondImageId = "44bb34f6-e981-4bb3-805f-ec4478ece9f9";

    expect(productImageOrderSchema.safeParse({
      params: { productId },
      body: { imageIds: [firstImageId, secondImageId] },
    }).success).toBe(true);
    expect(productImageOrderSchema.safeParse({
      params: { productId },
      body: { imageIds: [firstImageId, firstImageId] },
    }).success).toBe(false);
    expect(productImageUpdateSchema.safeParse({
      params: { productId, imageId: firstImageId },
      body: { altText: null },
    }).success).toBe(true);
    expect(productImageUpdateSchema.safeParse({
      params: { productId, imageId: firstImageId },
      body: {},
    }).success).toBe(false);
  });

  it("accepts only item identifiers and quantities from the cart and checkout clients", () => {
    const productId = "50baf97b-9b78-43ce-8a4c-a7f19112a957";
    expect(cartItemWriteSchema.safeParse({
      body: { productId, quantity: 2 },
    }).success).toBe(true);
    expect(cartItemWriteSchema.safeParse({
      body: { productId, quantity: 2, unitPrice: 1 },
    }).success).toBe(false);
    expect(checkoutSchema.safeParse({
      body: {
        shippingAddressId: productId,
        paymentMethod: "COD",
        total: 0,
      },
    }).success).toBe(false);
  });
});
