import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fileTypeFromBufferMock } = vi.hoisted(() => ({
  fileTypeFromBufferMock: vi.fn(),
}));
const { productImageFindUniqueMock, productImageUpdateManyMock } = vi.hoisted(() => ({
  productImageFindUniqueMock: vi.fn(),
  productImageUpdateManyMock: vi.fn(),
}));

vi.mock("file-type", () => ({ fileTypeFromBuffer: fileTypeFromBufferMock }));
vi.mock("../src/config/database.js", () => ({
  prisma: {
    productImage: {
      findUnique: productImageFindUniqueMock,
      updateMany: productImageUpdateManyMock,
    },
  },
}));

const { productImageDirectory } = await import("../src/config/local-storage.js");
const { runWithWorkerEnvironment } = await import("../src/config/worker-context.js");
const {
  deleteStoredProductImage,
  getStoredProductImage,
  uploadProductImage,
} = await import("../src/services/media.service.js");

const storedImages = new Set();

describe("local product image storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fileTypeFromBufferMock.mockResolvedValue({ mime: "image/jpeg", ext: "jpg" });
  });

  afterEach(async () => {
    for (const storagePath of storedImages) {
      await deleteStoredProductImage(storagePath);
      storedImages.delete(storagePath);
    }
  });

  it("validates the file signature and stores uploads in the project image directory", async () => {
    const buffer = Buffer.from("verified image bytes");
    const result = await uploadProductImage(buffer);
    storedImages.add(result.storagePath);

    expect(fileTypeFromBufferMock).toHaveBeenCalledWith(buffer);
    expect(result.storagePath).toMatch(/^[0-9a-f-]+\.jpg$/);
    expect(result.url).toBe(`/uploads/products/${result.storagePath}`);
    expect(await readFile(join(productImageDirectory, result.storagePath))).toEqual(buffer);

    await deleteStoredProductImage(result.storagePath);
    storedImages.delete(result.storagePath);
  });

  it("stores, retrieves, and deletes Worker image bytes through PostgreSQL", async () => {
    const buffer = Buffer.from("verified image bytes");
    productImageFindUniqueMock.mockResolvedValue({ data: buffer, format: "jpg" });

    const result = await runWithWorkerEnvironment({}, () => uploadProductImage(buffer));
    const storedImage = await runWithWorkerEnvironment(
      {},
      () => getStoredProductImage(result.storagePath),
    );
    await runWithWorkerEnvironment(
      {},
      () => deleteStoredProductImage(result.storagePath),
    );

    expect(result.data).toEqual(buffer);
    expect(productImageFindUniqueMock).toHaveBeenCalledWith({
      where: { storagePath: result.storagePath },
      select: { data: true, format: true },
    });
    expect(storedImage).toEqual({ data: buffer, contentType: "image/jpeg" });
    expect(productImageUpdateManyMock).toHaveBeenCalledWith({
      where: { storagePath: result.storagePath },
      data: { data: null },
    });
  });

  it("rejects content that is not an allowed image regardless of its filename or MIME header", async () => {
    fileTypeFromBufferMock.mockResolvedValue({ mime: "image/svg+xml", ext: "svg" });

    await expect(uploadProductImage(Buffer.from("<svg/>"))).rejects.toMatchObject({
      statusCode: 415,
      code: "UNSUPPORTED_IMAGE_TYPE",
    });
  });

  it("refuses storage paths that could escape the project image directory", async () => {
    await expect(deleteStoredProductImage("../../.env")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_IMAGE_STORAGE_PATH",
    });
  });

  it("treats a missing local file as an already-completed deletion", async () => {
    await expect(
      deleteStoredProductImage("123e4567-e89b-42d3-a456-426614174000.jpg"),
    ).resolves.toBeUndefined();
  });
});
