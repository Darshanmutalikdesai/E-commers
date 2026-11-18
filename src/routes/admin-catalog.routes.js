import { Router } from "express";
import {
  createBrand,
  createCategory,
  createProduct,
  deleteBrand,
  deleteCategory,
  deleteProduct,
  getAdminBrand,
  getAdminCategory,
  getAdminProduct,
  deleteProductImage,
  listAdminBrands,
  listAdminCategories,
  listAdminProducts,
  updateBrand,
  updateCategory,
  updateProduct,
  updateProductImage,
  uploadProductImage,
  setPrimaryProductImage,
  reorderProductImages,
} from "../controllers/catalog.controller.js";
import { authenticate, requirePermission, requireRoles } from "../middleware/authenticate.js";
import { sensitiveActionLimiter } from "../middleware/auth-rate-limit.js";
import { parseProductImageUpload } from "../middleware/product-image-upload.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  adminBrandQuerySchema,
  adminCategoryQuerySchema,
  adminProductQuerySchema,
  brandIdSchema,
  brandUpdateSchema,
  brandWriteSchema,
  categoryIdSchema,
  categoryUpdateSchema,
  categoryWriteSchema,
  productCreateSchema,
  productIdSchema,
  productImageIdSchema,
  productImageOrderSchema,
  productImageUpdateSchema,
  productImageUploadSchema,
  productUpdateSchema,
} from "../validation/auth.schemas.js";

const router = Router();
const catalogAdmin = [
  authenticate,
  requireRoles("ADMIN", "SUPER_ADMIN"),
  requirePermission("catalog:manage"),
];

router.get("/categories", ...catalogAdmin, validateRequest(adminCategoryQuerySchema), listAdminCategories);
router.post("/categories", ...catalogAdmin, validateRequest(categoryWriteSchema), createCategory);
router.get("/categories/:categoryId", ...catalogAdmin, validateRequest(categoryIdSchema), getAdminCategory);
router.patch(
  "/categories/:categoryId",
  ...catalogAdmin,
  validateRequest(categoryUpdateSchema),
  updateCategory,
);
router.delete("/categories/:categoryId", ...catalogAdmin, validateRequest(categoryIdSchema), deleteCategory);

router.get("/brands", ...catalogAdmin, validateRequest(adminBrandQuerySchema), listAdminBrands);
router.post("/brands", ...catalogAdmin, validateRequest(brandWriteSchema), createBrand);
router.get("/brands/:brandId", ...catalogAdmin, validateRequest(brandIdSchema), getAdminBrand);
router.patch("/brands/:brandId", ...catalogAdmin, validateRequest(brandUpdateSchema), updateBrand);
router.delete("/brands/:brandId", ...catalogAdmin, validateRequest(brandIdSchema), deleteBrand);

router.get("/products", ...catalogAdmin, validateRequest(adminProductQuerySchema), listAdminProducts);
router.post("/products", ...catalogAdmin, validateRequest(productCreateSchema), createProduct);
router.get("/products/:productId", ...catalogAdmin, validateRequest(productIdSchema), getAdminProduct);
router.patch("/products/:productId", ...catalogAdmin, validateRequest(productUpdateSchema), updateProduct);
router.delete("/products/:productId", ...catalogAdmin, validateRequest(productIdSchema), deleteProduct);
router.post(
  "/products/:productId/images",
  ...catalogAdmin,
  sensitiveActionLimiter,
  parseProductImageUpload,
  validateRequest(productImageUploadSchema),
  uploadProductImage,
);
router.patch(
  "/products/:productId/images/order",
  ...catalogAdmin,
  sensitiveActionLimiter,
  validateRequest(productImageOrderSchema),
  reorderProductImages,
);
router.patch(
  "/products/:productId/images/:imageId",
  ...catalogAdmin,
  validateRequest(productImageUpdateSchema),
  updateProductImage,
);
router.put(
  "/products/:productId/images/:imageId/primary",
  ...catalogAdmin,
  sensitiveActionLimiter,
  validateRequest(productImageIdSchema),
  setPrimaryProductImage,
);
router.delete(
  "/products/:productId/images/:imageId",
  ...catalogAdmin,
  sensitiveActionLimiter,
  validateRequest(productImageIdSchema),
  deleteProductImage,
);

export default router;
