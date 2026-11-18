import {
  addCartItem,
  addWishlistItem,
  clearCart,
  createGuestCart,
  getCartForRequest,
  listWishlist,
  mergeGuestCart,
  moveWishlistItemToCart,
  removeCartItem,
  removeWishlistItem,
  updateCartItem,
} from "../services/cart.service.js";

export async function createGuestCartHandler(req, res) {
  const result = await createGuestCart();
  return res.status(201).json(result);
}

export async function getCartHandler(req, res) {
  const cart = await getCartForRequest(req);
  return res.status(200).json({ cart });
}

export async function addCartItemHandler(req, res) {
  const cart = await addCartItem(req, req.validated.body);
  return res.status(200).json({ cart });
}

export async function updateCartItemHandler(req, res) {
  const cart = await updateCartItem(
    req,
    req.validated.params.itemId,
    req.validated.body.quantity,
  );
  return res.status(200).json({ cart });
}

export async function removeCartItemHandler(req, res) {
  await removeCartItem(req, req.validated.params.itemId);
  return res.status(204).end();
}

export async function clearCartHandler(req, res) {
  await clearCart(req);
  return res.status(204).end();
}

export async function mergeGuestCartHandler(req, res) {
  const cart = await mergeGuestCart(req);
  return res.status(200).json({ cart });
}

export async function getWishlistHandler(req, res) {
  const items = await listWishlist(req.auth.userId);
  return res.status(200).json({ items });
}

export async function addWishlistItemHandler(req, res) {
  const items = await addWishlistItem(req.auth.userId, req.validated.body.productId);
  return res.status(200).json({ items });
}

export async function removeWishlistItemHandler(req, res) {
  await removeWishlistItem(req.auth.userId, req.validated.params.productId);
  return res.status(204).end();
}

export async function moveWishlistItemToCartHandler(req, res) {
  const cart = await moveWishlistItemToCart(
    req,
    req.validated.params.productId,
    req.validated.body?.variantId ?? null,
  );
  return res.status(200).json({ cart });
}
