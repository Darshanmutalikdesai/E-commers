import multer from "multer";
import { AppError } from "../errors/app-error.js";

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1,
    fields: 1,
    fieldSize: 512,
  },
}).single("image");

export function parseProductImageUpload(req, res, next) {
  parser(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === "LIMIT_FILE_SIZE";
      next(new AppError(
        tooLarge ? 413 : 400,
        tooLarge ? "IMAGE_TOO_LARGE" : "INVALID_IMAGE_UPLOAD",
        tooLarge ? "Product images must be 10 MB or smaller" : "Upload one image using the image form field",
      ));
      return;
    }
    if (error) {
      next(error);
      return;
    }
    if (!req.file) {
      next(new AppError(400, "IMAGE_REQUIRED", "Upload an image using the image form field"));
      return;
    }
    next();
  });
}
