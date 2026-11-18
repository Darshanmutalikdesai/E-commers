import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function createEmailOtp() {
  return randomInt(100_000, 1_000_000).toString();
}

export function hashToken(value, purpose) {
  return createHmac("sha256", env.TOKEN_HASH_SECRET)
    .update(`${purpose}\0${value}`)
    .digest("hex");
}

export function safeHashEquals(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
