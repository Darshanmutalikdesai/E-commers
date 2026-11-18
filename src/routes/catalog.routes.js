import { Router } from "express";
import {
  getCategoryBySlug,
  getPublicProduct,
  listBrands,
  listCategories,
  listProducts,
} from "../controllers/catalog.controller.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  publicBrandQuerySchema,
  publicCategoryQuerySchema,
  publicProductQuerySchema,
  slugPathSchema,
} from "../validation/auth.schemas.js";

const router = Router();

router.get("/products", validateRequest(publicProductQuerySchema), listProducts);
router.get("/products/:slug", validateRequest(slugPathSchema), getPublicProduct);
router.get("/categories", validateRequest(publicCategoryQuerySchema), listCategories);
router.get("/categories/:slug", validateRequest(slugPathSchema), getCategoryBySlug);
router.get("/brands", validateRequest(publicBrandQuerySchema), listBrands);

export default router;
