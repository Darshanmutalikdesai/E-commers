import { Router } from "express";
import {
  createRefreshHandler,
  currentProfile,
  deactivateSelf,
  deleteSelf,
  listSessions,
  logout,
  logoutEverywhere,
  register,
  requestCustomerLoginCode,
  resendEmailVerification,
  revokeSession,
  verifyCustomerLoginCode,
  verifyEmailAddress,
} from "../controllers/auth.controller.js";
import {
  createCustomerAddress,
  deleteCustomerAddress,
  getCustomerAddress,
  listCustomerAddresses,
  listCustomerOrders,
  setCustomerDefaultAddress,
  updateCustomerAddress,
  updateCustomerProfile,
} from "../controllers/customer.controller.js";
import { authenticate, requireRoles } from "../middleware/authenticate.js";
import {
  challengeLimiter,
  loginLimiter,
  refreshLimiter,
  sensitiveActionLimiter,
} from "../middleware/auth-rate-limit.js";
import { validateRequest } from "../middleware/validate-request.js";
import {
  customerLoginOtpSchema,
  addressIdSchema,
  createAddressSchema,
  customerOrderQuerySchema,
  customerProfileSchema,
  emailOnlySchema,
  emailOtpSchema,
  refreshSchema,
  registerSchema,
  sessionIdSchema,
  updateAddressSchema,
} from "../validation/auth.schemas.js";

const router = Router();
const customerAuth = [authenticate, requireRoles("CUSTOMER")];

router.post("/register", challengeLimiter, validateRequest(registerSchema), register);
router.post("/verify-email", challengeLimiter, validateRequest(emailOtpSchema), verifyEmailAddress);
router.post("/verification/resend", challengeLimiter, validateRequest(emailOnlySchema), resendEmailVerification);
router.post("/login", challengeLimiter, validateRequest(customerLoginOtpSchema), requestCustomerLoginCode);
router.post("/login/verify-otp", loginLimiter, validateRequest(emailOtpSchema), verifyCustomerLoginCode);
router.post("/refresh", refreshLimiter, validateRequest(refreshSchema), createRefreshHandler("CUSTOMER"));

router.get("/me", ...customerAuth, currentProfile);
router.patch("/me", ...customerAuth, validateRequest(customerProfileSchema), updateCustomerProfile);
router.get("/addresses", ...customerAuth, listCustomerAddresses);
router.post("/addresses", ...customerAuth, validateRequest(createAddressSchema), createCustomerAddress);
router.get(
  "/addresses/:addressId",
  ...customerAuth,
  validateRequest(addressIdSchema),
  getCustomerAddress,
);
router.patch(
  "/addresses/:addressId",
  ...customerAuth,
  validateRequest(updateAddressSchema),
  updateCustomerAddress,
);
router.delete(
  "/addresses/:addressId",
  ...customerAuth,
  validateRequest(addressIdSchema),
  deleteCustomerAddress,
);
router.put(
  "/addresses/:addressId/default",
  ...customerAuth,
  validateRequest(addressIdSchema),
  setCustomerDefaultAddress,
);
router.get(
  "/orders",
  ...customerAuth,
  validateRequest(customerOrderQuerySchema),
  listCustomerOrders,
);
router.post("/logout", sensitiveActionLimiter, ...customerAuth, logout);
router.post("/logout-all", sensitiveActionLimiter, ...customerAuth, logoutEverywhere);
router.get("/sessions", ...customerAuth, listSessions);
router.delete(
  "/sessions/:sessionId",
  sensitiveActionLimiter,
  ...customerAuth,
  validateRequest(sessionIdSchema),
  revokeSession,
);
router.post("/deactivate", sensitiveActionLimiter, ...customerAuth, deactivateSelf);
router.delete("/account", sensitiveActionLimiter, ...customerAuth, deleteSelf);

export default router;
