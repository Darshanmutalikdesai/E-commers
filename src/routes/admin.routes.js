import { Router } from "express";
import {
  activityHistory,
  customerStatistics,
  createAdmin,
  deleteAdmin,
  getCustomerDetails,
  listAdmins,
  listCustomers,
  loginHistory,
  listCustomerOrderHistory,
  revokeAdminSessions,
  updateAdminStatus,
  updateCustomerStatus,
} from "../controllers/admin.controller.js";
import {
  changePasswordHandler,
  createForgotPasswordHandler,
  createLoginHandler,
  createRefreshHandler,
  currentProfile,
  listSessions,
  logout,
  logoutEverywhere,
  resetPasswordHandler,
  revokeSession,
  updateAdminProfile,
} from "../controllers/auth.controller.js";
import { authenticate, requirePermission, requireRoles } from "../middleware/authenticate.js";
import {
  challengeLimiter,
  loginLimiter,
  refreshLimiter,
  sensitiveActionLimiter,
} from "../middleware/auth-rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  auditQuerySchema,
  adminProfileSchema,
  changePasswordSchema,
  adminCustomerOrderQuerySchema,
  customerIdSchema,
  customerManagementQuerySchema,
  createAdminSchema,
  emailOnlySchema,
  loginSchema,
  listQuerySchema,
  refreshSchema,
  resetPasswordSchema,
  sessionIdSchema,
  updateAccountStatusSchema,
} from "../validation/auth.schemas.js";

const router = Router();
const adminAuth = [authenticate, requireRoles("ADMIN", "SUPER_ADMIN")];
const superAdmin = [authenticate, requireRoles("SUPER_ADMIN"), requirePermission("admin:manage")];

router.post("/auth/login", loginLimiter, validateRequest(loginSchema), createLoginHandler("ADMIN"));
router.post("/auth/refresh", refreshLimiter, validateRequest(refreshSchema), createRefreshHandler("ADMIN"));
router.post(
  "/auth/forgot-password",
  challengeLimiter,
  validateRequest(emailOnlySchema),
  createForgotPasswordHandler("ADMIN"),
);
router.post("/auth/reset-password", challengeLimiter, validateRequest(resetPasswordSchema), resetPasswordHandler);

router.get("/auth/me", ...adminAuth, currentProfile);
router.patch("/auth/profile", ...adminAuth, validateRequest(adminProfileSchema), updateAdminProfile);
router.post("/auth/logout", sensitiveActionLimiter, ...adminAuth, logout);
router.post("/auth/logout-all", sensitiveActionLimiter, ...adminAuth, logoutEverywhere);
router.get("/auth/sessions", ...adminAuth, listSessions);
router.delete(
  "/auth/sessions/:sessionId",
  sensitiveActionLimiter,
  ...adminAuth,
  validateRequest(sessionIdSchema),
  revokeSession,
);
router.post(
  "/auth/change-password",
  sensitiveActionLimiter,
  ...adminAuth,
  validateRequest(changePasswordSchema),
  changePasswordHandler,
);

router.get("/admins", ...superAdmin, validateRequest(listQuerySchema), listAdmins);
router.post("/admins", ...superAdmin, validateRequest(createAdminSchema), createAdmin);
router.patch(
  "/admins/:userId/status",
  ...superAdmin,
  validateRequest(updateAccountStatusSchema),
  updateAdminStatus,
);
router.delete("/admins/:userId", ...superAdmin, validateRequest(updateAccountStatusSchema.pick({ params: true })), deleteAdmin);
router.delete(
  "/admins/:userId/sessions",
  ...superAdmin,
  validateRequest(updateAccountStatusSchema.pick({ params: true })),
  revokeAdminSessions,
);

router.get(
  "/customers",
  ...adminAuth,
  requirePermission("customer:manage"),
  validateRequest(customerManagementQuerySchema),
  listCustomers,
);
router.get(
  "/customers/stats",
  ...adminAuth,
  requirePermission("customer:manage"),
  customerStatistics,
);
router.get(
  "/customers/:userId/orders",
  ...adminAuth,
  requirePermission("customer:manage"),
  validateRequest(adminCustomerOrderQuerySchema),
  listCustomerOrderHistory,
);
router.get(
  "/customers/:userId",
  ...adminAuth,
  requirePermission("customer:manage"),
  validateRequest(customerIdSchema),
  getCustomerDetails,
);
router.patch(
  "/customers/:userId/status",
  ...adminAuth,
  requirePermission("customer:manage"),
  validateRequest(updateAccountStatusSchema),
  updateCustomerStatus,
);
router.get(
  "/audit/login-history",
  ...adminAuth,
  requirePermission("audit:read"),
  validateRequest(auditQuerySchema),
  loginHistory,
);
router.get(
  "/audit/activity",
  ...adminAuth,
  requirePermission("audit:read"),
  validateRequest(auditQuerySchema),
  activityHistory,
);

export default router;
