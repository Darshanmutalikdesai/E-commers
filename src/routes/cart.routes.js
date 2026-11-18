import { Router } from "express";
import {
  addCartItemHandler,
  addWishlistItemHandler,
  clearCartHandler,
  createGuestCartHandler,
  getCartHandler,
  getWishlistHandler,
  mergeGuestCartHandler,
  moveWishlistItemToCartHandler,
  removeCartItemHandler,
  removeWishlistItemHandler,
  updateCartItemHandler,
} from "../controllers/cart.controller.js";
import { authenticate, optionalCustomerAuth, requireRoles } from "../middleware/authenticate.js";
import { sensitiveActionLimiter } from "../middleware/auth-rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  cartItemIdSchema,
  cartItemUpdateSchema,
  cartItemWriteSchema,
  wishlistItemPathSchema,
  wishlistItemSchema,
  wishlistMoveToCartSchema,
} from "../validation/auth.schemas.js";

const cartRouter = Router();
cartRouter.use(optionalCustomerAuth);
cartRouter.post("/guest", sensitiveActionLimiter, createGuestCartHandler);
cartRouter.post("/merge", requireRoles("CUSTOMER"), mergeGuestCartHandler);
cartRouter.get("/", getCartHandler);
cartRouter.post("/items", validateRequest(cartItemWriteSchema), addCartItemHandler);
cartRouter.patch("/items/:itemId", validateRequest(cartItemUpdateSchema), updateCartItemHandler);
cartRouter.delete("/items/:itemId", validateRequest(cartItemIdSchema), removeCartItemHandler);
cartRouter.delete("/", clearCartHandler);

const wishlistRouter = Router();
const customerAuth = [authenticate, requireRoles("CUSTOMER")];
wishlistRouter.get("/", ...customerAuth, getWishlistHandler);
wishlistRouter.post("/", ...customerAuth, validateRequest(wishlistItemSchema), addWishlistItemHandler);
wishlistRouter.delete(
  "/:productId",
  ...customerAuth,
  validateRequest(wishlistItemPathSchema),
  removeWishlistItemHandler,
);
wishlistRouter.post(
  "/:productId/cart",
  ...customerAuth,
  validateRequest(wishlistMoveToCartSchema),
  moveWishlistItemToCartHandler,
);

export { cartRouter, wishlistRouter };
