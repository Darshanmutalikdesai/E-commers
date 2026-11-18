ALTER TABLE "Category"
    ADD COLUMN "parentId" UUID,
    ADD COLUMN "seoTitle" VARCHAR(160),
    ADD COLUMN "seoDescription" VARCHAR(320),
    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

ALTER TABLE "Product"
    ADD COLUMN "shortDescription" VARCHAR(500),
    ADD COLUMN "mrp" DECIMAL(12,2),
    ADD COLUMN "gstRate" DECIMAL(5,2),
    ADD COLUMN "hsnCode" VARCHAR(12),
    ADD COLUMN "weightGrams" DECIMAL(10,3),
    ADD COLUMN "lengthCm" DECIMAL(10,2),
    ADD COLUMN "widthCm" DECIMAL(10,2),
    ADD COLUMN "heightCm" DECIMAL(10,2),
    ADD COLUMN "specifications" JSONB,
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "isBestSeller" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deletedAt" TIMESTAMPTZ(3),
    ADD COLUMN "brandId" UUID;

ALTER TABLE "Product" ALTER COLUMN "isActive" SET DEFAULT false;

CREATE TABLE "Brand" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sku" VARCHAR(80) NOT NULL,
    "size" VARCHAR(80),
    "color" VARCHAR(80),
    "sellingPrice" DECIMAL(12,2),
    "mrp" DECIMAL(12,2),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RelatedProduct" (
    "productId" UUID NOT NULL,
    "relatedProductId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RelatedProduct_pkey" PRIMARY KEY ("productId", "relatedProductId")
);

WITH ranked_addresses AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "userId"
            ORDER BY "isDefault" DESC, "createdAt", "id"
        ) AS position
    FROM "Address"
)
UPDATE "Address" AS address
SET "isDefault" = (ranked_addresses.position = 1)
FROM ranked_addresses
WHERE address."id" = ranked_addresses."id"
  AND address."isDefault" IS DISTINCT FROM (ranked_addresses.position = 1);

CREATE UNIQUE INDEX "Address_one_default_per_user_key"
    ON "Address"("userId") WHERE "isDefault" = true;
CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");
CREATE INDEX "Brand_isActive_name_idx" ON "Brand"("isActive", "name");
CREATE INDEX "Category_parentId_sortOrder_idx" ON "Category"("parentId", "sortOrder");
CREATE INDEX "Category_isActive_sortOrder_idx" ON "Category"("isActive", "sortOrder");
CREATE INDEX "Category_deletedAt_idx" ON "Category"("deletedAt");
CREATE INDEX "Product_brandId_idx" ON "Product"("brandId");
CREATE INDEX "Product_isFeatured_isActive_idx" ON "Product"("isFeatured", "isActive");
CREATE INDEX "Product_isBestSeller_isActive_idx" ON "Product"("isBestSeller", "isActive");
CREATE INDEX "Product_deletedAt_idx" ON "Product"("deletedAt");
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");
CREATE UNIQUE INDEX "ProductVariant_productId_size_color_key"
    ON "ProductVariant"("productId", "size", "color");
CREATE INDEX "ProductVariant_productId_isActive_idx"
    ON "ProductVariant"("productId", "isActive");
CREATE INDEX "RelatedProduct_relatedProductId_idx" ON "RelatedProduct"("relatedProductId");

ALTER TABLE "Category"
    ADD CONSTRAINT "Category_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Category"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Product"
    ADD CONSTRAINT "Product_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductVariant"
    ADD CONSTRAINT "ProductVariant_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RelatedProduct"
    ADD CONSTRAINT "RelatedProduct_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RelatedProduct"
    ADD CONSTRAINT "RelatedProduct_relatedProductId_fkey"
    FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
