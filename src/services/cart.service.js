import { prisma } from "../config/database.js";
import { AppError } from "../errors/app-error.js";
import { createOpaqueToken, hashToken } from "../utils/auth-crypto.js";

const guestCartLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const maxCartItems = 50;
const maxQuantity = 99;

function toPaise(value) {
  return Math.round(Number(value) * 100);
}

function fromPaise(value) {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, "0");
  return `${whole}.${fraction}`;
}

function taxInPaise(grossPaise, gstRate) {
  const rateBasisPoints = Math.round(Number(gstRate ?? 0) * 100);
  if (!rateBasisPoints) return 0;
  const gross = BigInt(grossPaise);
  const rate = BigInt(rateBasisPoints);
  return Number((gross * rate + (10_000n + rate) / 2n) / (10_000n + rate));
}

function guestTokenFromRequest(req) {
  const token = req.get("x-guest-cart-token");
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) {
    throw new AppError(401, "GUEST_CART_TOKEN_REQUIRED", "Create a guest cart and send its X-Guest-Cart-Token");
  }
  return token;
}

export async function resolveCart(client, req) {
  if (req.auth?.role === "CUSTOMER") {
    return client.cart.upsert({
      where: { customerId: req.auth.userId },
      update: {},
      create: { customerId: req.auth.userId },
      select: { id: true },
    });
  }

  if (req.auth) {
    throw new AppError(403, "FORBIDDEN", "Only customers can use a shopping cart");
  }

  const guestToken = guestTokenFromRequest(req);
  const cart = await client.cart.findUnique({
    where: { guestTokenHash: hashToken(guestToken, "guest-cart") },
    select: { id: true, guestExpiresAt: true },
  });
  if (!cart) throw new AppError(401, "INVALID_GUEST_CART_TOKEN", "Guest cart token is invalid");
  if (!cart.guestExpiresAt || cart.guestExpiresAt <= new Date()) {
    throw new AppError(410, "GUEST_CART_EXPIRED", "Guest cart has expired; create a new guest cart");
  }
  return cart;
}

export async function createGuestCart() {
  await prisma.cart.deleteMany({
    where: { guestExpiresAt: { lte: new Date() } },
  });
  const guestCartToken = createOpaqueToken();
  const cart = await prisma.cart.create({
    data: {
      guestTokenHash: hashToken(guestCartToken, "guest-cart"),
      guestExpiresAt: new Date(Date.now() + guestCartLifetimeMs),
    },
    select: { id: true },
  });
  return { guestCartToken, cart: await getCartById(cart.id) };
}

async function purchasableProduct(client, productId, variantId, requireVariant = true) {
  const product = await client.product.findFirst({
    where: {
      id: productId,
      isActive: true,
      deletedAt: null,
      AND: [{
        OR: [
          { categoryId: null },
          { category: { is: { isActive: true, deletedAt: null } } },
        ],
      }],
    },
    select: {
      id: true,
      sku: true,
      title: true,
      sellingPrice: true,
      mrp: true,
      gstRate: true,
      stock: true,
      variants: {
        select: {
          id: true,
          sku: true,
          size: true,
          color: true,
          sellingPrice: true,
          mrp: true,
          stock: true,
          isActive: true,
        },
      },
    },
  });
  if (!product) throw new AppError(409, "PRODUCT_UNAVAILABLE", "Product is no longer available");

  let variant = null;
  if (requireVariant && product.variants.length && !variantId) {
    throw new AppError(400, "PRODUCT_VARIANT_REQUIRED", "Select an active product variant");
  }
  if (!product.variants.length && variantId) {
    throw new AppError(400, "INVALID_PRODUCT_VARIANT", "This product does not have variants");
  }
  if (variantId) {
    variant = product.variants.find((candidate) => candidate.id === variantId);
    if (!variant?.isActive) {
      throw new AppError(409, "PRODUCT_VARIANT_UNAVAILABLE", "Selected product variant is no longer available");
    }
  }

  return { product, variant };
}

function stockFor(product, variant) {
  return variant ? variant.stock : product.stock;
}

function cartItemKey(variantId) {
  return variantId ?? "product";
}

async function addItemToCart(client, cartId, input) {
  const { product, variant } = await purchasableProduct(client, input.productId, input.variantId);
  const stock = stockFor(product, variant);
  const unique = {
    cartId_productId_variantKey: {
      cartId,
      productId: input.productId,
      variantKey: cartItemKey(input.variantId),
    },
  };
  const current = await client.cartItem.findUnique({
    where: unique,
    select: { id: true, quantity: true },
  });
  const quantity = (current?.quantity ?? 0) + input.quantity;
  if (quantity > maxQuantity || quantity > stock) {
    throw new AppError(409, "INSUFFICIENT_STOCK", "Requested quantity exceeds available stock", {
      availableStock: stock,
      requestedQuantity: quantity,
    });
  }
  if (!current) {
    const itemCount = await client.cartItem.count({ where: { cartId } });
    if (itemCount >= maxCartItems) {
      throw new AppError(409, "CART_ITEM_LIMIT_REACHED", `A cart can contain at most ${maxCartItems} items`);
    }
  }
  await client.cartItem.upsert({
    where: unique,
    create: {
      cartId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      variantKey: cartItemKey(input.variantId),
      quantity,
    },
    update: { quantity },
  });
}

async function lockCart(client, cartId) {
  const rows = await client.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cartId}::uuid FOR UPDATE`;
  if (Array.isArray(rows) && rows.length === 0) {
    throw new AppError(404, "CART_NOT_FOUND", "Shopping cart was not found");
  }
}

export async function getCartById(cartId) {
  const cart = await prisma.cart.findUnique({
    where: { id: cartId },
    select: {
      id: true,
      items: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          product: {
            select: {
              title: true,
              sku: true,
              isActive: true,
              deletedAt: true,
              sellingPrice: true,
              mrp: true,
              gstRate: true,
              stock: true,
              category: { select: { isActive: true, deletedAt: true } },
              variants: {
                select: {
                  id: true,
                  sku: true,
                  size: true,
                  color: true,
                  sellingPrice: true,
                  mrp: true,
                  stock: true,
                  isActive: true,
                },
              },
            },
          },
          variant: {
            select: {
              id: true,
              sku: true,
              size: true,
              color: true,
              sellingPrice: true,
              mrp: true,
              stock: true,
              isActive: true,
            },
          },
        },
      },
    },
  });
  if (!cart) throw new AppError(404, "CART_NOT_FOUND", "Shopping cart was not found");

  let subtotal = 0;
  let discountTotal = 0;
  let taxTotal = 0;
  let canCheckout = cart.items.length > 0;
  const items = cart.items.map((item) => {
    const { product, variant } = item;
    const hasVariants = product.variants.length > 0;
    const available = Boolean(
      product.isActive &&
      !product.deletedAt &&
      (!product.category || (product.category.isActive && !product.category.deletedAt)) &&
      (item.variantId ? variant?.isActive : !hasVariants),
    );
    if (!available) {
      canCheckout = false;
      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        productName: product.title,
        sku: item.variant?.sku ?? product.sku,
        variantLabel: item.variant ? [item.variant.size, item.variant.color].filter(Boolean).join(" / ") : null,
        quantity: item.quantity,
        unitPrice: null,
        lineTotal: null,
        discountAmount: null,
        taxAmount: null,
        availableStock: 0,
        available: false,
      };
    }

    const selected = variant ?? product;
    const unitPricePaise = toPaise(selected.sellingPrice ?? product.sellingPrice);
    const unitMrpPaise = toPaise(selected.mrp ?? product.mrp ?? selected.sellingPrice ?? product.sellingPrice);
    const lineTotalPaise = unitPricePaise * item.quantity;
    const lineDiscountPaise = Math.max(0, unitMrpPaise - unitPricePaise) * item.quantity;
    const lineTaxPaise = taxInPaise(lineTotalPaise, product.gstRate);
    const availableStock = stockFor(product, variant);
    const inStock = availableStock >= item.quantity;
    if (!inStock) canCheckout = false;
    subtotal += lineTotalPaise;
    discountTotal += lineDiscountPaise;
    taxTotal += lineTaxPaise;

    return {
      id: item.id,
      productId: item.productId,
      variantId: item.variantId,
      productName: product.title,
      sku: variant?.sku ?? product.sku,
      variantLabel: variant ? [variant.size, variant.color].filter(Boolean).join(" / ") : null,
      quantity: item.quantity,
      unitPrice: fromPaise(unitPricePaise),
      lineTotal: fromPaise(lineTotalPaise),
      discountAmount: fromPaise(lineDiscountPaise),
      taxAmount: fromPaise(lineTaxPaise),
      gstRate: String(product.gstRate ?? 0),
      availableStock,
      available: inStock,
    };
  });
  const shippingFee = 0;
  return {
    id: cart.id,
    items,
    subtotal: fromPaise(subtotal),
    discountTotal: fromPaise(discountTotal),
    taxTotal: fromPaise(taxTotal),
    shippingFee: fromPaise(shippingFee),
    total: fromPaise(subtotal + shippingFee),
    currency: "INR",
    canCheckout,
  };
}

export async function getCartForRequest(req) {
  const cart = await resolveCart(prisma, req);
  return getCartById(cart.id);
}

export async function addCartItem(req, input) {
  const cartId = await prisma.$transaction(async (tx) => {
    const cart = await resolveCart(tx, req);
    await lockCart(tx, cart.id);
    await addItemToCart(tx, cart.id, input);
    return cart.id;
  });
  return getCartById(cartId);
}

export async function updateCartItem(req, itemId, quantity) {
  const cartId = await prisma.$transaction(async (tx) => {
    const cart = await resolveCart(tx, req);
    await lockCart(tx, cart.id);
    const item = await tx.cartItem.findFirst({
      where: { id: itemId, cartId: cart.id },
      select: { id: true, productId: true, variantId: true },
    });
    if (!item) throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item was not found");
    const { product, variant } = await purchasableProduct(tx, item.productId, item.variantId);
    const availableStock = stockFor(product, variant);
    if (quantity > availableStock) {
      throw new AppError(409, "INSUFFICIENT_STOCK", "Requested quantity exceeds available stock", {
        availableStock,
        requestedQuantity: quantity,
      });
    }
    await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
    return cart.id;
  });
  return getCartById(cartId);
}

export async function removeCartItem(req, itemId) {
  await prisma.$transaction(async (tx) => {
    const cart = await resolveCart(tx, req);
    await lockCart(tx, cart.id);
    const result = await tx.cartItem.deleteMany({ where: { id: itemId, cartId: cart.id } });
    if (!result.count) throw new AppError(404, "CART_ITEM_NOT_FOUND", "Cart item was not found");
  });
}

export async function clearCart(req) {
  await prisma.$transaction(async (tx) => {
    const cart = await resolveCart(tx, req);
    await lockCart(tx, cart.id);
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
  });
}

export async function mergeGuestCart(req) {
  const rawToken = guestTokenFromRequest(req);
  const guestTokenHash = hashToken(rawToken, "guest-cart");
  await prisma.$transaction(async (tx) => {
    const guestCart = await tx.cart.findUnique({
      where: { guestTokenHash },
      select: { id: true, guestExpiresAt: true },
    });
    if (!guestCart) throw new AppError(404, "GUEST_CART_NOT_FOUND", "Guest cart was not found");
    if (!guestCart.guestExpiresAt || guestCart.guestExpiresAt <= new Date()) {
      throw new AppError(410, "GUEST_CART_EXPIRED", "Guest cart has expired; create a new guest cart");
    }

    const customerCart = await tx.cart.upsert({
      where: { customerId: req.auth.userId },
      update: {},
      create: { customerId: req.auth.userId },
      select: { id: true },
    });
    for (const id of [guestCart.id, customerCart.id].sort()) {
      await lockCart(tx, id);
    }
    const lockedGuestCart = await tx.cart.findUnique({
      where: { id: guestCart.id },
      select: { id: true, guestExpiresAt: true },
    });
    if (!lockedGuestCart) return;
    if (!lockedGuestCart.guestExpiresAt || lockedGuestCart.guestExpiresAt <= new Date()) {
      throw new AppError(410, "GUEST_CART_EXPIRED", "Guest cart has expired; create a new guest cart");
    }

    const guestItems = await tx.cartItem.findMany({
      where: { cartId: guestCart.id },
      orderBy: { createdAt: "asc" },
      select: { productId: true, variantId: true, quantity: true },
    });
    for (const item of guestItems) {
      await addItemToCart(tx, customerCart.id, {
        ...item,
        quantity: item.quantity,
      });
    }
    await tx.cart.delete({ where: { id: guestCart.id } });
  });
  return getCartForRequest(req);
}

export async function listWishlist(userId) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          title: true,
          slug: true,
          sku: true,
          sellingPrice: true,
          mrp: true,
          isActive: true,
          deletedAt: true,
          category: { select: { isActive: true, deletedAt: true } },
        },
      },
    },
  });
  return items.map(({ product, ...item }) => ({
    ...item,
    product: {
      ...product,
      available: product.isActive &&
        !product.deletedAt &&
        (!product.category || (product.category.isActive && !product.category.deletedAt)),
      sellingPrice: String(product.sellingPrice),
      mrp: String(product.mrp ?? product.sellingPrice),
      category: undefined,
    },
  }));
}

export async function addWishlistItem(userId, productId) {
  await purchasableProduct(prisma, productId, null, false);
  await prisma.wishlistItem.upsert({
    where: { userId_productId: { userId, productId } },
    update: {},
    create: { userId, productId },
  });
  return listWishlist(userId);
}

export async function removeWishlistItem(userId, productId) {
  const result = await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
  if (!result.count) throw new AppError(404, "WISHLIST_ITEM_NOT_FOUND", "Wishlist item was not found");
}

export async function moveWishlistItemToCart(req, productId, variantId = null) {
  const cartId = await prisma.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({
      where: { customerId: req.auth.userId },
      update: {},
      create: { customerId: req.auth.userId },
      select: { id: true },
    });
    await lockCart(tx, cart.id);
    const wishlistItem = await tx.wishlistItem.findUnique({
      where: { userId_productId: { userId: req.auth.userId, productId } },
      select: { id: true, productId: true },
    });
    if (!wishlistItem) throw new AppError(404, "WISHLIST_ITEM_NOT_FOUND", "Wishlist item was not found");
    await addItemToCart(tx, cart.id, { productId, variantId, quantity: 1 });
    const removed = await tx.wishlistItem.deleteMany({ where: { id: wishlistItem.id } });
    if (!removed.count) {
      throw new AppError(404, "WISHLIST_ITEM_NOT_FOUND", "Wishlist item was not found");
    }
    return cart.id;
  });
  return getCartById(cartId);
}

export function priceForOrder(product, variant, quantity) {
  const unitPrice = toPaise(variant?.sellingPrice ?? product.sellingPrice);
  const unitMrp = toPaise(variant?.mrp ?? product.mrp ?? product.sellingPrice);
  const lineTotal = unitPrice * quantity;
  return {
    unitPrice: fromPaise(unitPrice),
    unitMrp: fromPaise(unitMrp),
    lineTotal: fromPaise(lineTotal),
    discountAmount: fromPaise(Math.max(0, unitMrp - unitPrice) * quantity),
    taxAmount: fromPaise(taxInPaise(lineTotal, product.gstRate)),
    subtotalPaise: lineTotal,
    discountPaise: Math.max(0, unitMrp - unitPrice) * quantity,
    taxPaise: taxInPaise(lineTotal, product.gstRate),
  };
}

export function orderMoneyFromPaise(value) {
  return fromPaise(value);
}

export async function getPurchasableProduct(client, productId, variantId) {
  return purchasableProduct(client, productId, variantId);
}

export async function lockShoppingCart(client, cartId) {
  return lockCart(client, cartId);
}
