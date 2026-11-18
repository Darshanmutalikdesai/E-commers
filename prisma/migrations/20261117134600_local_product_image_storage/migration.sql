ALTER TABLE "ProductImage"
    ADD COLUMN "storagePath" VARCHAR(255);

ALTER TABLE "ProductImage"
    RENAME COLUMN "secureUrl" TO "url";

ALTER TABLE "ProductImage"
    ALTER COLUMN "width" DROP NOT NULL,
    ALTER COLUMN "height" DROP NOT NULL;

DROP INDEX "ProductImage_cloudinaryPublicId_key";

ALTER TABLE "ProductImage"
    DROP COLUMN "cloudinaryPublicId";

CREATE UNIQUE INDEX "ProductImage_storagePath_key" ON "ProductImage"("storagePath");
