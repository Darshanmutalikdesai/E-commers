import { randomUUID } from "node:crypto";
import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import {
  deleteStoredProductImage,
  uploadProductImage as storeProductImage,
} from "../services/media.service.js";

const maxProductImages = 12;
const productImageSelect = {
  id: true,
  url: true,
  altText: true,
  sortOrder: true,
  isPrimary: true,
  width: true,
  height: true,
  format: true,
  bytes: true,
  createdAt: true,
};

const categoryInclude = {
  parent: { select: { id: true, name: true, slug: true } },
  _count: { select: { products: true, children: true } },
};

const brandSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

const productInclude = {
  category: { select: { id: true, name: true, slug: true, isActive: true, deletedAt: true } },
  brand: { select: { id: true, name: true, slug: true, isActive: true, deletedAt: true } },
  variants: { orderBy: [{ size: "asc" }, { color: "asc" }] },
  images: {
    select: productImageSelect,
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  },
  relatedFrom: {
    select: {
      relatedProduct: {
        select: { id: true, title: true, slug: true, isActive: true, deletedAt: true },
      },
    },
  },
};

const publicProductInclude = {
  ...productInclude,
  variants: {
    where: { isActive: true },
    orderBy: [{ size: "asc" }, { color: "asc" }],
  },
};

function publicProductWhere() {
  return {
    isActive: true,
    deletedAt: null,
    AND: [
      { OR: [{ categoryId: null }, { category: { is: { isActive: true, deletedAt: null } } }] },
    ],
  };
}

function toProductResponse(product) {
  const { relatedFrom, ...fields } = product;
  delete fields.deletedAt;
  const sellingPrice = Number(product.sellingPrice);
  const mrp = Number(product.mrp ?? product.sellingPrice);
  return {
    ...fields,
    discountPercentage: mrp > 0
      ? Number((((mrp - sellingPrice) / mrp) * 100).toFixed(2))
      : 0,
    category: product.category?.deletedAt || !product.category?.isActive ? null : product.category,
    brand: product.brand?.deletedAt || !product.brand?.isActive ? null : product.brand,
    availableStock: product.variants.length
      ? product.variants.reduce((total, variant) => total + (variant.isActive ? variant.stock : 0), 0)
      : product.stock,
    relatedProducts: relatedFrom
      .map(({ relatedProduct }) => relatedProduct)
      .filter((related) => related.isActive && !related.deletedAt)
      .map(({ isActive, deletedAt, ...related }) => related),
  };
}

async function lockProductForImageMutation(tx, productId, includeDeleted = false) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
  const product = await tx.product.findFirst({
    where: { id: productId, ...(includeDeleted ? {} : { deletedAt: null }) },
    select: { id: true },
  });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
}

function uniqueConflict(error, resource) {
  if (error.code === "P2002") {
    throw new AppError(409, "CATALOG_CONFLICT", `${resource} name, slug, or SKU is already in use`);
  }
  throw error;
}

async function assertCategoryParent(client, parentId, currentId) {
  if (!parentId) return;
  if (parentId === currentId) {
    throw new AppError(400, "INVALID_CATEGORY_PARENT", "A category cannot be its own parent");
  }

  let cursorId = parentId;
  for (let depth = 0; cursorId && depth < 32; depth += 1) {
    const parent = await client.category.findUnique({
      where: { id: cursorId },
      select: { id: true, parentId: true, isActive: true, deletedAt: true },
    });
    if (!parent || !parent.isActive || parent.deletedAt) {
      throw new AppError(400, "INVALID_CATEGORY_PARENT", "Parent category is unavailable");
    }
    if (parent.id === currentId) {
      throw new AppError(400, "CATEGORY_CYCLE", "Category hierarchy cannot contain a cycle");
    }
    cursorId = parent.parentId;
    if (depth === 31 && cursorId) {
      throw new AppError(400, "CATEGORY_DEPTH_EXCEEDED", "Category hierarchy cannot exceed 32 levels");
    }
  }
}

async function assertProductReferences(client, { categoryId, brandId }) {
  if (categoryId) {
    const category = await client.category.findFirst({
      where: { id: categoryId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!category) {
      throw new AppError(400, "INVALID_CATEGORY", "Selected category is unavailable");
    }
  }
  if (brandId) {
    const brand = await client.brand.findFirst({
      where: { id: brandId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!brand) {
      throw new AppError(400, "INVALID_BRAND", "Selected brand is unavailable");
    }
  }
}

async function assertRelatedProducts(client, ids, productId) {
  if (!ids) return;
  if (new Set(ids).size !== ids.length || ids.includes(productId)) {
    throw new AppError(400, "INVALID_RELATED_PRODUCTS", "Related product IDs must be unique and cannot include this product");
  }
  if (!ids.length) return;
  const count = await client.product.count({
    where: { id: { in: ids }, deletedAt: null },
  });
  if (count !== ids.length) {
    throw new AppError(400, "INVALID_RELATED_PRODUCTS", "One or more related products were not found");
  }
}

function validateVariantPrices(variants, productPrice, productMrp) {
  for (const variant of variants ?? []) {
    const price = variant.sellingPrice ?? productPrice;
    const mrp = variant.mrp ?? productMrp;
    if (mrp !== undefined && mrp < price) {
      throw new AppError(400, "INVALID_VARIANT_PRICE", "Variant MRP must be equal to or greater than its selling price");
    }
  }
  const attributes = (variants ?? []).map((variant) => `${variant.size ?? ""}\0${variant.color ?? ""}`);
  if (new Set(attributes).size !== attributes.length) {
    throw new AppError(400, "DUPLICATE_VARIANT", "Variant size and color combinations must be unique");
  }
}

export async function listCategories(req, res) {
  const { page, limit, search, parentId } = req.validated.query;
  const where = {
    isActive: true,
    deletedAt: null,
    ...(parentId ? { parentId } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [categories, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        parent: { select: { id: true, name: true, slug: true } },
        children: {
          where: { isActive: true, deletedAt: null },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: { id: true, name: true, slug: true, sortOrder: true },
        },
      },
    }),
    prisma.category.count({ where }),
  ]);
  return res.status(200).json({ categories, page, limit, total });
}

export async function getCategoryBySlug(req, res) {
  const category = await prisma.category.findFirst({
    where: { slug: req.validated.params.slug, isActive: true, deletedAt: null },
    include: {
      parent: { select: { id: true, name: true, slug: true } },
      children: {
        where: { isActive: true, deletedAt: null },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: { id: true, name: true, slug: true, sortOrder: true },
      },
    },
  });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "Category was not found");
  return res.status(200).json({ category });
}

export async function listAdminCategories(req, res) {
  const { page, limit, search, parentId, isActive, includeDeleted } = req.validated.query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(isActive === undefined ? {} : { isActive }),
    ...(parentId ? { parentId } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [categories, total] = await prisma.$transaction([
    prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: categoryInclude,
    }),
    prisma.category.count({ where }),
  ]);
  return res.status(200).json({ categories, page, limit, total });
}

export async function getAdminCategory(req, res) {
  const category = await prisma.category.findFirst({
    where: { id: req.validated.params.categoryId, deletedAt: null },
    include: categoryInclude,
  });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "Category was not found");
  return res.status(200).json({ category });
}

export async function createCategory(req, res) {
  const input = req.validated.body;
  try {
    const category = await prisma.$transaction(async (tx) => {
      await assertCategoryParent(tx, input.parentId, null);
      return tx.category.create({
        data: input,
        include: categoryInclude,
      });
    });
    return res.status(201).json({ category });
  } catch (error) {
    uniqueConflict(error, "Category");
  }
}

export async function updateCategory(req, res) {
  const { categoryId } = req.validated.params;
  const input = req.validated.body;
  try {
    const category = await prisma.$transaction(async (tx) => {
      const current = await tx.category.findFirst({
        where: { id: categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!current) throw new AppError(404, "CATEGORY_NOT_FOUND", "Category was not found");
      if (Object.hasOwn(input, "parentId")) {
        await assertCategoryParent(tx, input.parentId, categoryId);
      }
      if (input.isActive === false) {
        const activeChildren = await tx.category.count({
          where: { parentId: categoryId, isActive: true, deletedAt: null },
        });
        if (activeChildren) {
          throw new AppError(409, "CATEGORY_HAS_ACTIVE_CHILDREN", "Deactivate or reassign child categories first");
        }
      }
      return tx.category.update({
        where: { id: categoryId },
        data: input,
        include: categoryInclude,
      });
    });
    return res.status(200).json({ category });
  } catch (error) {
    uniqueConflict(error, "Category");
  }
}

export async function deleteCategory(req, res) {
  const { categoryId } = req.validated.params;
  const category = await prisma.category.findFirst({
    where: { id: categoryId, deletedAt: null },
    select: {
      id: true,
      _count: { select: { products: true, children: true } },
    },
  });
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "Category was not found");
  if (category._count.products || category._count.children) {
    throw new AppError(409, "CATEGORY_IN_USE", "Reassign its products and child categories before deleting it");
  }
  await prisma.category.update({
    where: { id: categoryId },
    data: { isActive: false, deletedAt: new Date() },
  });
  return res.status(204).end();
}

export async function listBrands(req, res) {
  const { page, limit, search } = req.validated.query;
  const where = {
    isActive: true,
    deletedAt: null,
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [brands, total] = await prisma.$transaction([
    prisma.brand.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: brandSelect,
    }),
    prisma.brand.count({ where }),
  ]);
  return res.status(200).json({ brands, page, limit, total });
}

export async function listAdminBrands(req, res) {
  const { page, limit, search, isActive, includeDeleted } = req.validated.query;
  const where = {
    ...(includeDeleted ? {} : { deletedAt: null }),
    ...(isActive === undefined ? {} : { isActive }),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [brands, total] = await prisma.$transaction([
    prisma.brand.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      select: brandSelect,
    }),
    prisma.brand.count({ where }),
  ]);
  return res.status(200).json({ brands, page, limit, total });
}

export async function getAdminBrand(req, res) {
  const brand = await prisma.brand.findFirst({
    where: { id: req.validated.params.brandId, deletedAt: null },
    select: brandSelect,
  });
  if (!brand) throw new AppError(404, "BRAND_NOT_FOUND", "Brand was not found");
  return res.status(200).json({ brand });
}

export async function createBrand(req, res) {
  try {
    const brand = await prisma.brand.create({
      data: req.validated.body,
      select: brandSelect,
    });
    return res.status(201).json({ brand });
  } catch (error) {
    uniqueConflict(error, "Brand");
  }
}

export async function updateBrand(req, res) {
  const { brandId } = req.validated.params;
  try {
    const brand = await prisma.brand.updateMany({
      where: { id: brandId, deletedAt: null },
      data: req.validated.body,
    });
    if (!brand.count) throw new AppError(404, "BRAND_NOT_FOUND", "Brand was not found");
    const updated = await prisma.brand.findUnique({
      where: { id: brandId },
      select: brandSelect,
    });
    return res.status(200).json({ brand: updated });
  } catch (error) {
    uniqueConflict(error, "Brand");
  }
}

export async function deleteBrand(req, res) {
  const { brandId } = req.validated.params;
  const result = await prisma.brand.updateMany({
    where: { id: brandId, deletedAt: null },
    data: { isActive: false, deletedAt: new Date() },
  });
  if (!result.count) throw new AppError(404, "BRAND_NOT_FOUND", "Brand was not found");
  return res.status(204).end();
}

function productWhere(query, includeAdminFilters) {
  const where = {
    ...(query.includeDeleted ? {} : { deletedAt: null }),
    ...(includeAdminFilters && query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.brandId ? { brandId: query.brandId } : {}),
    ...(query.featured === undefined ? {} : { isFeatured: query.featured }),
    ...(query.bestSeller === undefined ? {} : { isBestSeller: query.bestSeller }),
    ...(query.search ? {
      OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
        { sku: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { tags: { has: query.search } },
      ],
    } : {}),
  };
  if (!includeAdminFilters) {
    Object.assign(where, publicProductWhere());
    if (query.featured !== undefined) where.isFeatured = query.featured;
    if (query.bestSeller !== undefined) where.isBestSeller = query.bestSeller;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.brandId) where.brandId = query.brandId;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
        { description: { contains: query.search, mode: "insensitive" } },
        { tags: { has: query.search } },
      ];
    }
  }
  if (query.newArrival !== undefined) {
    const threshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    where.createdAt = query.newArrival ? { gte: threshold } : { lt: threshold };
  }
  return where;
}

const orderByForProduct = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  "price-asc": { sellingPrice: "asc" },
  "price-desc": { sellingPrice: "desc" },
  "title-asc": { title: "asc" },
};

export async function listProducts(req, res) {
  const { page, limit, sort } = req.validated.query;
  const where = productWhere(req.validated.query, false);
  const [records, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: [orderByForProduct[sort], { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: publicProductInclude,
    }),
    prisma.product.count({ where }),
  ]);
  return res.status(200).json({
    products: records.map(toProductResponse),
    page,
    limit,
    total,
  });
}

export async function listAdminProducts(req, res) {
  const { page, limit, sort } = req.validated.query;
  const where = productWhere(req.validated.query, true);
  const [records, total] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: [orderByForProduct[sort], { id: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: productInclude,
    }),
    prisma.product.count({ where }),
  ]);
  return res.status(200).json({
    products: records.map(toProductResponse),
    page,
    limit,
    total,
  });
}

export async function getPublicProduct(req, res) {
  const product = await prisma.product.findFirst({
    where: { ...publicProductWhere(), slug: req.validated.params.slug },
    include: publicProductInclude,
  });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
  return res.status(200).json({ product: toProductResponse(product) });
}

export async function getAdminProduct(req, res) {
  const product = await prisma.product.findFirst({
    where: { id: req.validated.params.productId, deletedAt: null },
    include: productInclude,
  });
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
  return res.status(200).json({ product: toProductResponse(product) });
}

function productWriteData(input, create = false) {
  const {
    variants,
    relatedProductIds,
    ...data
  } = input;
  if (create) {
    data.stock ??= 0;
    data.mrp ??= data.sellingPrice;
    data.isActive ??= false;
  }
  return { data, variants, relatedProductIds };
}

async function replaceProductRelations(tx, productId, variants, relatedProductIds) {
  if (variants !== undefined) {
    const existing = await tx.productVariant.findMany({
      where: { productId },
      select: {
        id: true,
        sku: true,
        size: true,
        color: true,
        _count: { select: { orderItems: true } },
      },
    });
    const retainedIds = new Set();
    const assignments = variants.map((variant) => {
      const current = existing.find((candidate) =>
        !retainedIds.has(candidate.id) &&
        candidate.size === (variant.size ?? null) &&
        candidate.color === (variant.color ?? null),
      ) ?? existing.find((candidate) =>
        !retainedIds.has(candidate.id) && candidate.sku === variant.sku,
      );
      if (current) {
        retainedIds.add(current.id);
      }
      return { current, variant };
    });

    for (const { current } of assignments) {
      if (current) {
        await tx.productVariant.update({
          where: { id: current.id },
          data: { sku: `sync-${randomUUID()}` },
        });
      }
    }
    for (const { current, variant } of assignments) {
      if (current) {
        await tx.productVariant.update({
          where: { id: current.id },
          data: variant,
        });
      } else {
        await tx.productVariant.create({
          data: { ...variant, productId },
        });
      }
    }

    const removed = existing.filter((variant) => !retainedIds.has(variant.id));
    const removableIds = removed
      .filter((variant) => variant._count.orderItems === 0)
      .map((variant) => variant.id);
    if (removableIds.length) {
      await tx.productVariant.deleteMany({ where: { id: { in: removableIds } } });
    }
    const orderedVariantIds = removed
      .filter((variant) => variant._count.orderItems > 0)
      .map((variant) => variant.id);
    if (orderedVariantIds.length) {
      await tx.productVariant.updateMany({
        where: { id: { in: orderedVariantIds } },
        data: { isActive: false },
      });
    }
  }
  if (relatedProductIds !== undefined) {
    await tx.relatedProduct.deleteMany({ where: { productId } });
    if (relatedProductIds.length) {
      await tx.relatedProduct.createMany({
        data: relatedProductIds.map((relatedProductId) => ({ productId, relatedProductId })),
      });
    }
  }
}

export async function createProduct(req, res) {
  const { data, variants, relatedProductIds } = productWriteData(req.validated.body, true);
  validateVariantPrices(variants, data.sellingPrice, data.mrp);
  try {
    const product = await prisma.$transaction(async (tx) => {
      await assertProductReferences(tx, data);
      await assertRelatedProducts(tx, relatedProductIds);
      const created = await tx.product.create({ data });
      await replaceProductRelations(tx, created.id, variants, relatedProductIds);
      return tx.product.findUnique({
        where: { id: created.id },
        include: productInclude,
      });
    });
    return res.status(201).json({ product: toProductResponse(product) });
  } catch (error) {
    uniqueConflict(error, "Product");
  }
}

export async function updateProduct(req, res) {
  const { productId } = req.validated.params;
  const { data, variants, relatedProductIds } = productWriteData(req.validated.body);
  try {
    const product = await prisma.$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, sellingPrice: true, mrp: true },
      });
      if (!current) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");

      const sellingPrice = data.sellingPrice ?? Number(current.sellingPrice);
      const mrp = data.mrp ?? Number(current.mrp ?? current.sellingPrice);
      if (mrp < sellingPrice) {
        throw new AppError(400, "INVALID_PRODUCT_PRICE", "MRP must be equal to or greater than the selling price");
      }
      if (variants !== undefined) {
        validateVariantPrices(variants, sellingPrice, mrp);
      }
      await assertProductReferences(tx, data);
      await assertRelatedProducts(tx, relatedProductIds, productId);

      await tx.product.update({ where: { id: productId }, data });
      await replaceProductRelations(tx, productId, variants, relatedProductIds);
      return tx.product.findUnique({
        where: { id: productId },
        include: productInclude,
      });
    });
    return res.status(200).json({ product: toProductResponse(product) });
  } catch (error) {
    uniqueConflict(error, "Product");
  }
}

export async function deleteProduct(req, res) {
  const result = await prisma.product.updateMany({
    where: { id: req.validated.params.productId, deletedAt: null },
    data: { isActive: false, deletedAt: new Date() },
  });
  if (!result.count) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
  return res.status(204).end();
}

export async function uploadProductImage(req, res) {
  const { productId } = req.validated.params;
  const existingProduct = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });
  if (!existingProduct) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");

  const uploaded = await storeProductImage(req.file.buffer);
  try {
    const image = await prisma.$transaction(async (tx) => {
      await lockProductForImageMutation(tx, productId);
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, _count: { select: { images: true } } },
      });
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Product was not found");
      if (product._count.images >= maxProductImages) {
        throw new AppError(409, "PRODUCT_IMAGE_LIMIT_REACHED", `A product can have at most ${maxProductImages} images`);
      }

      return tx.productImage.create({
        data: {
          productId,
          storagePath: uploaded.storagePath,
          url: uploaded.url,
          altText: req.validated.body.altText ?? null,
          sortOrder: product._count.images,
          isPrimary: product._count.images === 0,
          width: uploaded.width,
          height: uploaded.height,
          format: uploaded.format,
          bytes: uploaded.bytes,
        },
        select: productImageSelect,
      });
    });
    return res.status(201).json({ image });
  } catch (error) {
    try {
      await deleteStoredProductImage(uploaded.storagePath);
    } catch (cleanupError) {
      console.error("Could not clean up a locally uploaded product image after a database failure", {
        storagePath: uploaded.storagePath,
        databaseError: error.message,
        error: cleanupError.message,
      });
      throw new AppError(
        500,
        "IMAGE_PERSISTENCE_AND_CLEANUP_FAILED",
        "The image was saved locally, but its database record and local cleanup both failed",
      );
    }
    throw error;
  }
}

export async function updateProductImage(req, res) {
  const { productId, imageId } = req.validated.params;
  const image = await prisma.$transaction(async (tx) => {
    await lockProductForImageMutation(tx, productId);
    const updated = await tx.productImage.updateMany({
      where: { id: imageId, productId },
      data: { altText: req.validated.body.altText },
    });
    if (!updated.count) throw new AppError(404, "PRODUCT_IMAGE_NOT_FOUND", "Product image was not found");
    return tx.productImage.findUnique({
      where: { id: imageId },
      select: productImageSelect,
    });
  });
  return res.status(200).json({ image });
}

export async function setPrimaryProductImage(req, res) {
  const { productId, imageId } = req.validated.params;
  const image = await prisma.$transaction(async (tx) => {
    await lockProductForImageMutation(tx, productId);
    const target = await tx.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true },
    });
    if (!target) throw new AppError(404, "PRODUCT_IMAGE_NOT_FOUND", "Product image was not found");
    await tx.productImage.updateMany({
      where: { productId, isPrimary: true },
      data: { isPrimary: false },
    });
    return tx.productImage.update({
      where: { id: imageId },
      data: { isPrimary: true },
      select: productImageSelect,
    });
  });
  return res.status(200).json({ image });
}

export async function reorderProductImages(req, res) {
  const { productId } = req.validated.params;
  const { imageIds } = req.validated.body;
  const images = await prisma.$transaction(async (tx) => {
    await lockProductForImageMutation(tx, productId);
    const existing = await tx.productImage.findMany({
      where: { productId },
      select: { id: true },
    });
    if (
      existing.length !== imageIds.length ||
      !imageIds.every((imageId) => existing.some((image) => image.id === imageId))
    ) {
      throw new AppError(400, "INVALID_PRODUCT_IMAGE_ORDER", "Provide every image ID for this product exactly once");
    }

    await tx.productImage.updateMany({
      where: { productId, isPrimary: true },
      data: { isPrimary: false },
    });
    for (const [sortOrder, imageId] of imageIds.entries()) {
      await tx.productImage.update({
        where: { id: imageId },
        data: { sortOrder, isPrimary: sortOrder === 0 },
      });
    }
    return tx.productImage.findMany({
      where: { productId },
      select: productImageSelect,
      orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });
  });
  return res.status(200).json({ images });
}

export async function deleteProductImage(req, res) {
  const { productId, imageId } = req.validated.params;
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, storagePath: true },
  });
  if (!image) throw new AppError(404, "PRODUCT_IMAGE_NOT_FOUND", "Product image was not found");

  if (image.storagePath) await deleteStoredProductImage(image.storagePath);
  await prisma.$transaction(async (tx) => {
    await lockProductForImageMutation(tx, productId, true);
    const current = await tx.productImage.findFirst({
      where: { id: imageId, productId },
      select: { id: true, isPrimary: true },
    });
    if (!current) throw new AppError(404, "PRODUCT_IMAGE_NOT_FOUND", "Product image was not found");
    await tx.productImage.delete({ where: { id: imageId } });
    if (current.isPrimary) {
      const nextPrimary = await tx.productImage.findFirst({
        where: { productId },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (nextPrimary) {
        await tx.productImage.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        });
      }
    }
  });
  return res.status(204).end();
}
