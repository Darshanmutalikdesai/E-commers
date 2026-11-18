import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { productImageDirectory } from "../config/local-storage.js";
import { AppError } from "../errors/app-error.js";

const imageExtensions = new Map([
  ["image/avif", "avif"],
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const storedImageNamePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(avif|gif|jpg|png|webp)$/;

export async function uploadProductImage(buffer) {
  const detectedType = await fileTypeFromBuffer(buffer);
  const extension = imageExtensions.get(detectedType?.mime);
  if (!extension) {
    throw new AppError(415, "UNSUPPORTED_IMAGE_TYPE", "Upload a valid JPEG, PNG, WebP, AVIF, or GIF image");
  }

  const id = randomUUID();
  const storagePath = `${id}.${extension}`;
  const finalPath = join(productImageDirectory, storagePath);
  const tempFilePath = join(productImageDirectory, `.${id}.tmp`);

  try {
    await mkdir(productImageDirectory, { recursive: true, mode: 0o750 });
    await writeFile(tempFilePath, buffer, { flag: "wx", mode: 0o640 });
    await rename(tempFilePath, finalPath);
  } catch (error) {
    try {
      await unlink(tempFilePath);
    } catch (cleanupError) {
      if (cleanupError.code !== "ENOENT") {
        console.error("Could not remove a temporary product image after a local storage failure", {
          error: cleanupError.message,
        });
      }
    }
    throw new AppError(500, "LOCAL_IMAGE_STORAGE_FAILED", "The product image could not be saved locally");
  }

  return {
    storagePath,
    url: `/uploads/products/${storagePath}`,
    width: undefined,
    height: undefined,
    format: extension,
    bytes: buffer.length,
  };
}

export async function deleteStoredProductImage(storagePath) {
  if (!storedImageNamePattern.test(storagePath)) {
    throw new AppError(400, "INVALID_IMAGE_STORAGE_PATH", "Product image storage path is invalid");
  }

  try {
    await unlink(join(productImageDirectory, storagePath));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new AppError(500, "LOCAL_IMAGE_DELETE_FAILED", "The product image could not be deleted locally");
    }
  }
}
