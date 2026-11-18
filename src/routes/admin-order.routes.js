import { Router } from "express";
import {
  adminInvoiceHandler,
  getAdminOrderHandler,
  listAdminOrdersHandler,
  updateAdminOrderStatusHandler,
  updateAdminPaymentStatusHandler,
} from "../controllers/order.controller.js";
import { authenticate, requirePermission, requireRoles } from "../middleware/authenticate.js";
import { sensitiveActionLimiter } from "../middleware/auth-rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  adminOrderListSchema,
  adminOrderStatusSchema,
  adminPaymentStatusSchema,
  orderIdSchema,
} from "../validation/auth.schemas.js";

const router = Router();
const adminAuth = [authenticate, requireRoles("ADMIN", "SUPER_ADMIN")];
const orderManager = [...adminAuth, requirePermission("orders:manage")];

router.get("/", ...orderManager, validateRequest(adminOrderListSchema), listAdminOrdersHandler);
router.get("/:orderId/invoice", ...orderManager, validateRequest(orderIdSchema), adminInvoiceHandler);
router.get("/:orderId", ...orderManager, validateRequest(orderIdSchema), getAdminOrderHandler);
router.patch(
  "/:orderId/status",
  ...orderManager,
  sensitiveActionLimiter,
  validateRequest(adminOrderStatusSchema),
  updateAdminOrderStatusHandler,
);
router.patch(
  "/:orderId/payment-status",
  ...adminAuth,
  requirePermission("payments:manage"),
  sensitiveActionLimiter,
  validateRequest(adminPaymentStatusSchema),
  updateAdminPaymentStatusHandler,
);

export default router;
