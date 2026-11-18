import { z } from "zod";

const emailSchema = z.string().trim().email().max(320).transform((email) => email.toLowerCase());
const passwordSchema = z.string()
  .min(12, "Password must be at least 12 characters")
  .max(128)
  .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes");
const personNameSchema = z.string().trim().min(1).max(100);

export const registerSchema = z.object({
  body: z.object({
    email: emailSchema,
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
  }).strict(),
});

export const loginSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: z.string()
      .min(1)
      .max(128)
      .refine((password) => Buffer.byteLength(password, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes"),
  }).strict(),
});

export const emailOtpSchema = z.object({
  body: z.object({
    email: emailSchema,
    otp: z.string().regex(/^\d{6}$/),
  }).strict(),
});

export const emailOnlySchema = z.object({
  body: z.object({ email: emailSchema }).strict(),
});

export const customerLoginOtpSchema = emailOnlySchema;

export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(40).max(200) }).strict(),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(40).max(200),
    newPassword: passwordSchema,
  }).strict(),
});

export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordSchema,
  }).strict().refine((body) => body.currentPassword !== body.newPassword, {
    message: "New password must differ from current password",
    path: ["newPassword"],
  }),
});

export const sessionIdSchema = z.object({
  params: z.object({ sessionId: z.uuid() }),
});

export const createAdminSchema = z.object({
  body: z.object({
    email: emailSchema,
    password: passwordSchema,
    firstName: personNameSchema,
    lastName: personNameSchema,
  }).strict(),
});

export const adminProfileSchema = z.object({
  body: z.object({
    firstName: personNameSchema,
    lastName: personNameSchema,
  }).strict(),
});

export const updateAccountStatusSchema = z.object({
  params: z.object({ userId: z.uuid() }),
  body: z.object({ isActive: z.boolean() }).strict(),
});

export const auditQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    userId: z.uuid().optional(),
  }).strict(),
});

export const listQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }).strict(),
});

const booleanQuerySchema = z.enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

export const customerProfileSchema = z.object({
  body: z.object({
    firstName: personNameSchema.optional(),
    lastName: personNameSchema.optional(),
    phone: z.string().trim().min(7).max(30).nullable().optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, {
    message: "At least one profile field is required",
  }),
});

const addressFields = z.object({
  label: z.string().trim().min(1).max(50).nullable().optional(),
  recipientName: z.string().trim().min(1).max(200),
  phone: z.string().trim().min(7).max(30),
  addressLine1: z.string().trim().min(1).max(255),
  addressLine2: z.string().trim().max(255).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  country: z.string().trim().length(2).toUpperCase().optional(),
  isDefault: z.boolean().optional(),
});

export const createAddressSchema = z.object({
  body: addressFields.strict(),
});

export const updateAddressSchema = z.object({
  params: z.object({ addressId: z.uuid() }),
  body: addressFields.partial().strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: "At least one address field is required",
    }),
});

export const addressIdSchema = z.object({
  params: z.object({ addressId: z.uuid() }),
});

export const customerOrderQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.enum([
      "PENDING",
      "CONFIRMED",
      "PROCESSING",
      "PACKED",
      "SHIPPED",
      "OUT_FOR_DELIVERY",
      "DELIVERED",
      "CANCELLED",
      "RETURN_REQUESTED",
      "RETURNED",
      "REFUND_PENDING",
      "REFUNDED",
    ]).optional(),
  }).strict(),
});

const orderStatusSchema = z.enum([
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "RETURN_REQUESTED",
  "RETURNED",
  "REFUND_PENDING",
  "REFUNDED",
]);

export const cartItemWriteSchema = z.object({
  body: z.object({
    productId: z.uuid(),
    variantId: z.uuid().nullable().optional(),
    quantity: z.number().int().min(1).max(99).default(1),
  }).strict(),
});

export const cartItemUpdateSchema = z.object({
  params: z.object({ itemId: z.uuid() }),
  body: z.object({
    quantity: z.number().int().min(1).max(99),
  }).strict(),
});

export const cartItemIdSchema = z.object({
  params: z.object({ itemId: z.uuid() }),
});

export const wishlistItemSchema = z.object({
  body: z.object({
    productId: z.uuid(),
  }).strict(),
});

export const wishlistItemPathSchema = z.object({
  params: z.object({ productId: z.uuid() }),
});

export const wishlistMoveToCartSchema = z.object({
  params: z.object({ productId: z.uuid() }),
  body: z.object({
    variantId: z.uuid().nullable().optional(),
  }).strict().optional(),
});

export const checkoutSchema = z.object({
  body: z.object({
    shippingAddressId: z.uuid(),
    billingAddressId: z.uuid().optional(),
    paymentMethod: z.enum(["COD", "MANUAL"]),
    notes: z.string().trim().max(1000).nullable().optional(),
  }).strict(),
});

export const orderIdSchema = z.object({
  params: z.object({ orderId: z.uuid() }),
});

export const orderCancelSchema = z.object({
  params: z.object({ orderId: z.uuid() }),
  body: z.object({
    reason: z.string().trim().min(1).max(500).optional(),
  }).strict().optional(),
});

export const orderReturnSchema = z.object({
  params: z.object({ orderId: z.uuid() }),
  body: z.object({
    reason: z.string().trim().min(1).max(500),
  }).strict(),
});

export const orderListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: orderStatusSchema.optional(),
  }).strict(),
});

export const adminOrderListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: orderStatusSchema.optional(),
    paymentStatus: z.enum(["PENDING", "PAID", "REFUNDED"]).optional(),
    search: z.string().trim().min(1).max(120).optional(),
  }).strict(),
});

export const adminOrderStatusSchema = z.object({
  params: z.object({ orderId: z.uuid() }),
  body: z.object({
    status: orderStatusSchema,
    comment: z.string().trim().min(1).max(500).optional(),
  }).strict(),
});

export const adminPaymentStatusSchema = z.object({
  params: z.object({ orderId: z.uuid() }),
  body: z.object({
    paymentStatus: z.enum(["PAID", "REFUNDED"]),
    comment: z.string().trim().min(1).max(500).optional(),
  }).strict(),
});

export const customerManagementQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().trim().min(1).max(120).optional(),
    isActive: booleanQuerySchema,
    isEmailVerified: booleanQuerySchema,
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
  }).strict().refine((query) => (
    !query.createdFrom || !query.createdTo || query.createdFrom <= query.createdTo
  ), {
    message: "createdFrom must be earlier than createdTo",
  }),
});

const slugSchema = z.string().trim().toLowerCase().min(1).max(220)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const categoryWriteSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema.max(140),
    description: z.string().max(20_000).nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    seoTitle: z.string().trim().max(160).nullable().optional(),
    seoDescription: z.string().trim().max(320).nullable().optional(),
    sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
    isActive: z.boolean().optional(),
  }).strict(),
});

export const categoryUpdateSchema = z.object({
  params: z.object({ categoryId: z.uuid() }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: slugSchema.max(140).optional(),
    description: z.string().max(20_000).nullable().optional(),
    parentId: z.uuid().nullable().optional(),
    seoTitle: z.string().trim().max(160).nullable().optional(),
    seoDescription: z.string().trim().max(320).nullable().optional(),
    sortOrder: z.number().int().min(-100_000).max(100_000).optional(),
    isActive: z.boolean().optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, {
    message: "At least one category field is required",
  }),
});

export const categoryIdSchema = z.object({
  params: z.object({ categoryId: z.uuid() }),
});

export const brandWriteSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema.max(140),
    description: z.string().max(20_000).nullable().optional(),
    isActive: z.boolean().optional(),
  }).strict(),
});

export const brandUpdateSchema = z.object({
  params: z.object({ brandId: z.uuid() }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: slugSchema.max(140).optional(),
    description: z.string().max(20_000).nullable().optional(),
    isActive: z.boolean().optional(),
  }).strict().refine((body) => Object.keys(body).length > 0, {
    message: "At least one brand field is required",
  }),
});

export const brandIdSchema = z.object({
  params: z.object({ brandId: z.uuid() }),
});

const productVariantSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  size: z.string().trim().min(1).max(80).optional(),
  color: z.string().trim().min(1).max(80).optional(),
  sellingPrice: z.number().finite().min(0).max(9_999_999_999.99).optional(),
  mrp: z.number().finite().min(0).max(9_999_999_999.99).optional(),
  stock: z.number().int().min(0).max(2_000_000_000).default(0),
  isActive: z.boolean().default(true),
}).strict().refine((variant) => Boolean(variant.size || variant.color), {
  message: "Each variant must specify a size, a color, or both",
});

const productFields = z.object({
  sku: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(50_000).nullable().optional(),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  sellingPrice: z.number().finite().min(0).max(9_999_999_999.99),
  mrp: z.number().finite().min(0).max(9_999_999_999.99).optional(),
  stock: z.number().int().min(0).max(2_000_000_000).optional(),
  gstRate: z.number().finite().min(0).max(100).nullable().optional(),
  hsnCode: z.string().trim().max(12).nullable().optional(),
  weightGrams: z.number().finite().positive().max(1_000_000_000).nullable().optional(),
  lengthCm: z.number().finite().positive().max(1_000_000).nullable().optional(),
  widthCm: z.number().finite().positive().max(1_000_000).nullable().optional(),
  heightCm: z.number().finite().positive().max(1_000_000).nullable().optional(),
  specifications: z.record(z.string(), z.unknown()).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(50).optional(),
  isFeatured: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  isActive: z.boolean().optional(),
  categoryId: z.uuid().nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  variants: z.array(productVariantSchema).max(100).optional(),
  relatedProductIds: z.array(z.uuid()).max(50).optional(),
}).strict();

export const productCreateSchema = z.object({
  body: productFields.refine((product) => (
    product.mrp === undefined || product.mrp >= product.sellingPrice
  ), {
    message: "MRP must be equal to or greater than the selling price",
    path: ["mrp"],
  }).refine((product) => new Set(product.variants?.map((variant) => variant.sku)).size === (product.variants?.length ?? 0), {
    message: "Variant SKUs must be unique within the product",
    path: ["variants"],
  }),
});

export const productUpdateSchema = z.object({
  params: z.object({ productId: z.uuid() }),
  body: productFields.partial()
    .refine((product) => Object.keys(product).length > 0, {
      message: "At least one product field is required",
    })
    .refine((product) => (
      product.mrp === undefined ||
      product.sellingPrice === undefined ||
      product.mrp >= product.sellingPrice
    ), {
      message: "MRP must be equal to or greater than the selling price",
      path: ["mrp"],
    })
    .refine((product) => new Set(product.variants?.map((variant) => variant.sku)).size === (product.variants?.length ?? 0), {
      message: "Variant SKUs must be unique within the product",
      path: ["variants"],
    }),
});

export const productIdSchema = z.object({
  params: z.object({ productId: z.uuid() }),
});

export const productImageUploadSchema = z.object({
  params: z.object({ productId: z.uuid() }),
  body: z.object({
    altText: z.string().trim().min(1).max(200).optional(),
  }).strict(),
});

export const productImageIdSchema = z.object({
  params: z.object({
    productId: z.uuid(),
    imageId: z.uuid(),
  }),
});

export const productImageUpdateSchema = z.object({
  params: z.object({
    productId: z.uuid(),
    imageId: z.uuid(),
  }),
  body: z.object({
    altText: z.string().trim().min(1).max(200).nullable(),
  }).strict(),
});

export const productImageOrderSchema = z.object({
  params: z.object({ productId: z.uuid() }),
  body: z.object({
    imageIds: z.array(z.uuid()).min(1).max(12),
  }).strict().refine(({ imageIds }) => new Set(imageIds).size === imageIds.length, {
    message: "Image IDs must be unique",
  }),
});

const productQueryFields = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(120).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  featured: booleanQuerySchema,
  bestSeller: booleanQuerySchema,
  newArrival: booleanQuerySchema,
  sort: z.enum(["newest", "oldest", "price-asc", "price-desc", "title-asc"]).default("newest"),
});

export const publicProductQuerySchema = z.object({
  query: productQueryFields.strict(),
});

export const adminProductQuerySchema = z.object({
  query: productQueryFields.extend({
    isActive: booleanQuerySchema,
    includeDeleted: booleanQuerySchema,
  }).strict(),
});

export const customerIdSchema = z.object({
  params: z.object({ userId: z.uuid() }),
});

export const adminCustomerOrderQuerySchema = z.object({
  params: z.object({ userId: z.uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: orderStatusSchema.optional(),
  }).strict(),
});

const catalogListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  search: z.string().trim().min(1).max(120).optional(),
});

export const publicCategoryQuerySchema = z.object({
  query: catalogListQuery.extend({ parentId: z.uuid().optional() }).strict(),
});

export const adminCategoryQuerySchema = z.object({
  query: catalogListQuery.extend({
    parentId: z.uuid().optional(),
    isActive: booleanQuerySchema,
    includeDeleted: booleanQuerySchema,
  }).strict(),
});

export const publicBrandQuerySchema = z.object({
  query: catalogListQuery.strict(),
});

export const adminBrandQuerySchema = z.object({
  query: catalogListQuery.extend({
    isActive: booleanQuerySchema,
    includeDeleted: booleanQuerySchema,
  }).strict(),
});

export const slugPathSchema = z.object({
  params: z.object({ slug: slugSchema }),
});
