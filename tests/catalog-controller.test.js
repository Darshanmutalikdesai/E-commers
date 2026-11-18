import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock, mediaMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
    product: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    productImage: { findFirst: vi.fn() },
  },
  txMock: {
    $queryRaw: vi.fn(),
    category: { findFirst: vi.fn() },
    brand: { findFirst: vi.fn() },
    product: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    productImage: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    productVariant: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    relatedProduct: { deleteMany: vi.fn(), createMany: vi.fn() },
  },
  mediaMock: {
    uploadProductImage: vi.fn(),
    deleteStoredProductImage: vi.fn(),
  },
}));

vi.mock("../src/config/database.js", () => ({ prisma: prismaMock }));
vi.mock("../src/services/media.service.js", () => mediaMock);

const {
  createProduct,
  deleteProductImage,
  listProducts,
  reorderProductImages,
  setPrimaryProductImage,
  updateProduct,
  uploadProductImage,
} = await import("../src/controllers/catalog.controller.js");

describe("catalog product management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation((operation) => (
      Array.isArray(operation) ? Promise.all(operation) : operation(txMock)
    ));
    txMock.category.findFirst.mockResolvedValue(null);
    txMock.brand.findFirst.mockResolvedValue(null);
    prismaMock.product.findFirst.mockResolvedValue({ id: "product-id" });
    txMock.$queryRaw.mockResolvedValue([{ id: "product-id" }]);
    txMock.product.findFirst.mockResolvedValue({ id: "product-id", _count: { images: 0 } });
    txMock.productImage.create.mockResolvedValue({
      id: "image-id",
      url: "/uploads/products/image.jpg",
      isPrimary: true,
    });
    txMock.productImage.updateMany.mockResolvedValue({ count: 1 });
    txMock.productImage.update.mockResolvedValue({
      id: "image-id",
      url: "/uploads/products/image.jpg",
      isPrimary: true,
    });
    mediaMock.uploadProductImage.mockResolvedValue({
      storagePath: "123e4567-e89b-42d3-a456-426614174000.jpg",
      url: "/uploads/products/123e4567-e89b-42d3-a456-426614174000.jpg",
      format: "jpg",
      bytes: 1200,
    });
    mediaMock.deleteStoredProductImage.mockResolvedValue(undefined);
    txMock.product.create.mockResolvedValue({ id: "product-id" });
    txMock.product.findUnique.mockResolvedValue({
      id: "product-id",
      sku: "SKU-1",
      title: "Test Product",
      slug: "test-product",
      sellingPrice: 20,
      mrp: 25,
      stock: 5,
      variants: [],
      category: null,
      brand: null,
      relatedFrom: [],
      images: [],
    });
  });

  it("returns only published products and filters new arrivals", async () => {
    prismaMock.product.findMany.mockResolvedValue([{
      id: "product-id",
      sellingPrice: 20,
      mrp: 25,
      stock: 5,
      variants: [],
      category: null,
      brand: null,
      relatedFrom: [],
      images: [{ id: "image-id", url: "/uploads/products/image.jpg", isPrimary: true }],
    }]);
    prismaMock.product.count.mockResolvedValue(1);
    const req = {
      validated: {
        query: {
          page: 1,
          limit: 10,
          sort: "newest",
          newArrival: true,
        },
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await listProducts(req, res);

    const { where } = prismaMock.product.findMany.mock.calls[0][0];
    expect(where).toMatchObject({ isActive: true, deletedAt: null });
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      products: [expect.objectContaining({ discountPercentage: 20, availableStock: 5 })],
    }));
    expect(res.json.mock.calls[0][0].products[0].images).toEqual([
      { id: "image-id", url: "/uploads/products/image.jpg", isPrimary: true },
    ]);
  });

  it("creates products unpublished unless the admin explicitly publishes them", async () => {
    const req = {
      validated: {
        body: {
          sku: "SKU-1",
          title: "Test Product",
          slug: "test-product",
          sellingPrice: 20,
        },
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await createProduct(req, res);

    expect(txMock.product.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        isActive: false,
        stock: 0,
        mrp: 20,
      }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("keeps ordered variants as inactive inventory records when removed from the catalog", async () => {
    txMock.product.findFirst.mockResolvedValue({
      id: "product-id",
      sellingPrice: 20,
      mrp: 25,
    });
    txMock.productVariant.findMany.mockResolvedValue([{
      id: "variant-id",
      sku: "SKU-1-S",
      size: "S",
      color: null,
      _count: { orderItems: 1 },
    }]);
    const req = {
      validated: {
        params: { productId: "product-id" },
        body: { variants: [] },
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await updateProduct(req, res);

    expect(txMock.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["variant-id"] } },
      data: { isActive: false },
    });
    expect(txMock.productVariant.deleteMany).not.toHaveBeenCalled();
  });

  it("persists an uploaded image as the primary image on the first upload", async () => {
    const imageData = Buffer.from("stored image bytes");
    mediaMock.uploadProductImage.mockResolvedValueOnce({
      storagePath: "123e4567-e89b-42d3-a456-426614174000.jpg",
      url: "/uploads/products/123e4567-e89b-42d3-a456-426614174000.jpg",
      format: "jpg",
      bytes: imageData.length,
      data: imageData,
    });
    const req = {
      file: { buffer: Buffer.from("image") },
      validated: {
        params: { productId: "product-id" },
        body: { altText: "Front view" },
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };

    await uploadProductImage(req, res);

    expect(txMock.productImage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productId: "product-id",
        altText: "Front view",
        sortOrder: 0,
        isPrimary: true,
        data: imageData,
      }),
      select: expect.objectContaining({ url: true }),
    });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("removes the uploaded asset if the product gallery limit is reached", async () => {
    txMock.product.findFirst.mockResolvedValue({ id: "product-id", _count: { images: 12 } });
    const req = {
      file: { buffer: Buffer.from("image") },
      validated: { params: { productId: "product-id" }, body: {} },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await expect(uploadProductImage(req, res)).rejects.toMatchObject({
      statusCode: 409,
      code: "PRODUCT_IMAGE_LIMIT_REACHED",
    });
    expect(mediaMock.deleteStoredProductImage).toHaveBeenCalledWith(
      "123e4567-e89b-42d3-a456-426614174000.jpg",
    );
  });

  it("makes the selected image primary after clearing the previous primary", async () => {
    txMock.productImage.findFirst.mockResolvedValue({ id: "second-image" });
    const req = {
      validated: { params: { productId: "product-id", imageId: "second-image" } },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await setPrimaryProductImage(req, res);

    expect(txMock.productImage.updateMany).toHaveBeenCalledWith({
      where: { productId: "product-id", isPrimary: true },
      data: { isPrimary: false },
    });
    expect(txMock.productImage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "second-image" },
      data: { isPrimary: true },
    }));
  });

  it("reorders only when the submitted IDs cover the full product gallery", async () => {
    txMock.productImage.findMany
      .mockResolvedValueOnce([{ id: "first-image" }, { id: "second-image" }])
      .mockResolvedValueOnce([]);
    const req = {
      validated: {
        params: { productId: "product-id" },
        body: { imageIds: ["second-image", "first-image"] },
      },
    };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await reorderProductImages(req, res);

    expect(txMock.productImage.update).toHaveBeenNthCalledWith(1, {
      where: { id: "second-image" },
      data: { sortOrder: 0, isPrimary: true },
    });
    expect(txMock.productImage.update).toHaveBeenNthCalledWith(2, {
      where: { id: "first-image" },
      data: { sortOrder: 1, isPrimary: false },
    });
  });

  it("deletes the remote asset before removing its database record", async () => {
    prismaMock.productImage.findFirst.mockResolvedValue({
      id: "image-id",
      storagePath: "123e4567-e89b-42d3-a456-426614174000.jpg",
    });
    txMock.productImage.findFirst
      .mockResolvedValueOnce({ id: "image-id", isPrimary: false });
    txMock.productImage.delete.mockResolvedValue({ id: "image-id" });
    const req = {
      validated: { params: { productId: "product-id", imageId: "image-id" } },
    };
    const res = { status: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis() };

    await deleteProductImage(req, res);

    expect(mediaMock.deleteStoredProductImage).toHaveBeenCalledWith(
      "123e4567-e89b-42d3-a456-426614174000.jpg",
    );
    expect(txMock.productImage.delete).toHaveBeenCalledWith({ where: { id: "image-id" } });
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
