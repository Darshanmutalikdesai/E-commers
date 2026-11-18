import { Router } from "express";
import {
  cancelCustomerOrderHandler,
  checkoutHandler,
  customerInvoiceHandler,
  getCustomerOrderHandler,
  listCustomerOrdersHandler,
  requestOrderReturnHandler,
} from "../controllers/order.controller.js";
import { authenticate, requireRoles } from "../middleware/authenticate.js";
import { sensitiveActionLimiter } from "../middleware/auth-rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  checkoutSchema,
  orderCancelSchema,
  orderIdSchema,
  orderListSchema,
  orderReturnSchema,
} from "../validation/auth.schemas.js";

const router = Router();
const customerAuth = [authenticate, requireRoles("CUSTOMER")];

router.post("/checkout", ...customerAuth, validateRequest(checkoutSchema), checkoutHandler);
router.get("/orders", ...customerAuth, validateRequest(orderListSchema), listCustomerOrdersHandler);
router.get("/orders/:orderId/invoice", ...customerAuth, validateRequest(orderIdSchema), customerInvoiceHandler);
router.get("/orders/:orderId", ...customerAuth, validateRequest(orderIdSchema), getCustomerOrderHandler);
router.post(
  "/orders/:orderId/cancel",
  sensitiveActionLimiter,
  ...customerAuth,
  validateRequest(orderCancelSchema),
  cancelCustomerOrderHandler,
);
router.post(
  "/orders/:orderId/return",
  sensitiveActionLimiter,
  ...customerAuth,
  validateRequest(orderReturnSchema),
  requestOrderReturnHandler,
);

export default router;
