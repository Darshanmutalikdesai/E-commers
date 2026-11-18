ALTER TYPE "OrderStatus" ADD VALUE 'PACKED' AFTER 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE 'OUT_FOR_DELIVERY' AFTER 'SHIPPED';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURN_REQUESTED';
ALTER TYPE "OrderStatus" ADD VALUE 'RETURNED';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUND_PENDING';
ALTER TYPE "OrderStatus" ADD VALUE 'REFUNDED';

ALTER TABLE "Order"
    ADD COLUMN "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "taxTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "billingAddress" JSONB,
    ADD COLUMN "returnReason" VARCHAR(500);

UPDATE "Order"
SET "billingAddress" = "shippingAddress";

ALTER TABLE "Order"
    ALTER COLUMN "billingAddress" SET NOT NULL;

ALTER TABLE "OrderItem"
    ADD COLUMN "unitMrp" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN "variantId" UUID,
    ADD COLUMN "variantLabel" VARCHAR(200);

UPDATE "OrderItem"
SET "unitMrp" = "unitPrice";

CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "customerId" UUID,
    "guestTokenHash" VARCHAR(64),
    "guestExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Cart_exactly_one_owner_check"
        CHECK (("customerId" IS NULL) <> ("guestTokenHash" IS NULL)),
    CONSTRAINT "Cart_guest_expiry_check"
        CHECK (("guestTokenHash" IS NULL) = ("guestExpiresAt" IS NULL))
);

CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "variantKey" VARCHAR(40) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CartItem_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99)
);

CREATE TABLE "WishlistItem" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WishlistItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderStatusHistory" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "changedByUserId" UUID,
    "comment" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Cart_customerId_key" ON "Cart"("customerId");
CREATE UNIQUE INDEX "Cart_guestTokenHash_key" ON "Cart"("guestTokenHash");
CREATE INDEX "Cart_guestExpiresAt_idx" ON "Cart"("guestExpiresAt");
CREATE UNIQUE INDEX "CartItem_cartId_productId_variantKey_key"
    ON "CartItem"("cartId", "productId", "variantKey");
CREATE INDEX "CartItem_productId_idx" ON "CartItem"("productId");
CREATE UNIQUE INDEX "WishlistItem_userId_productId_key" ON "WishlistItem"("userId", "productId");
CREATE INDEX "WishlistItem_productId_idx" ON "WishlistItem"("productId");
CREATE INDEX "OrderStatusHistory_orderId_createdAt_idx"
    ON "OrderStatusHistory"("orderId", "createdAt");
CREATE INDEX "Order_paymentStatus_createdAt_idx" ON "Order"("paymentStatus", "createdAt");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

ALTER TABLE "Cart"
    ADD CONSTRAINT "Cart_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_cartId_fkey"
    FOREIGN KEY ("cartId") REFERENCES "Cart"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CartItem"
    ADD CONSTRAINT "CartItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem"
    ADD CONSTRAINT "WishlistItem_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WishlistItem"
    ADD CONSTRAINT "WishlistItem_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusHistory"
    ADD CONSTRAINT "OrderStatusHistory_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusHistory"
    ADD CONSTRAINT "OrderStatusHistory_changedByUserId_fkey"
    FOREIGN KEY ("changedByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem"
    ADD CONSTRAINT "OrderItem_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OrderStatusHistory" ("id", "orderId", "fromStatus", "toStatus", "comment")
SELECT gen_random_uuid(), "id", NULL, "status", 'Initial status migrated'
FROM "Order";
