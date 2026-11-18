import cors from "cors";
import express from "express";
import helmet from "helmet";
import { corsOrigins } from "./config/env.js";
import { productImageDirectory } from "./config/local-storage.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFound } from "./middleware/not-found.js";
import adminRoutes from "./routes/admin.routes.js";
import authRoutes from "./routes/auth.routes.js";
import catalogRoutes from "./routes/catalog.routes.js";
import adminCatalogRoutes from "./routes/admin-catalog.routes.js";
import { cartRouter, wishlistRouter } from "./routes/cart.routes.js";
import healthRoutes from "./routes/health.routes.js";
import orderRoutes from "./routes/order.routes.js";
import adminOrderRoutes from "./routes/admin-order.routes.js";

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/uploads/products", express.static(productImageDirectory, {
  fallthrough: true,
  immutable: true,
  maxAge: "1y",
  setHeaders(res) {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
}));

app.use("/api/v1/health", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", catalogRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/admin", adminCatalogRoutes);
app.use("/api/v1/cart", cartRouter);
app.use("/api/v1/wishlist", wishlistRouter);
app.use("/api/v1", orderRoutes);
app.use("/api/v1/admin/orders", adminOrderRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
