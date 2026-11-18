# Single-seller e-commerce backend

A Node.js/Express REST API foundation for a single-seller store. The initial phase provides configuration, PostgreSQL persistence through Prisma, database migrations, and health checks. It intentionally has no vendor accounts or payment gateway integration.

## Requirements

- Node.js 22+ and a PostgreSQL database (Neon is supported)

## Quick start

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to the connection string from your Neon dashboard. Use the pooled connection string for the API, retain Neon’s `sslmode=require` and other query parameters, and URL-encode special characters in the username or password.
3. Generate two independent secrets and set them in `.env`:

   ```sh
   openssl rand -hex 32
   ```

   Run the command twice. Use one result for `JWT_ACCESS_SECRET` and another for `TOKEN_HASH_SECRET`. Keep these stable across API replicas; rotating `TOKEN_HASH_SECRET` invalidates outstanding refresh and email-challenge tokens.

4. Configure all five `SMTP_*` settings to enable verification and sign-in-code emails. Port 465 uses implicit TLS; other ports use SMTP STARTTLS when available.
5. Install dependencies and apply the schema:

   ```sh
   npm ci
   npm run db:generate
   npm run db:migrate
   ```

6. Start the API:

   ```sh
   npm run dev
   ```

7. Check the API at `http://localhost:3000/api/v1/health`. Database readiness is available at `http://localhost:3000/api/v1/health/ready`.

Keep `.env` private and never commit or share it.

## Local development

1. Copy `.env.example` to `.env`, configure `DATABASE_URL`, and set independent random JWT and token-hashing secrets as above.
2. Configure all SMTP settings before using email verification or customer sign-in.
3. Install dependencies and apply the schema:

   ```sh
   npm ci
   npm run db:generate
   npm run db:migrate
   ```

4. Start the API:

   ```sh
   npm run dev
   ```

`npm run db:migrate` applies development migrations. Use `npm run db:deploy` to apply checked-in migrations in a deployed environment. Prisma uses the PostgreSQL driver adapter; the app connects to the database before accepting requests.

On a fresh local setup, replace both example secrets before running the API. The project `.env` is ignored by Git; keep its permissions private.

## Environment

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `PORT` | No | `3000` | HTTP listen port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `CORS_ORIGIN` | No | `http://localhost:3000` | Comma-separated allowed browser origins |
| `JWT_ACCESS_SECRET` | Yes | — | Random secret of at least 32 characters for signing access tokens |
| `TOKEN_HASH_SECRET` | Yes | — | Independent random secret for HMAC-hashing refresh tokens and email challenges |
| `REFRESH_SESSION_DAYS` | No | `30` | Maximum refresh-session lifetime (1–90 days) |
| `EMAIL_OTP_MINUTES` | No | `10` | Email verification-code lifetime (1–60 minutes) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | For email | — | Configure all five to enable email; partial SMTP configuration fails validation |

## Customer authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Register a customer and email a six-digit verification code |
| `POST` | `/api/v1/auth/verify-email` | Verify `{ "email": "...", "otp": "123456" }` |
| `POST` | `/api/v1/auth/verification/resend` | Resend an email code |
| `POST` | `/api/v1/auth/login` | Request a sign-in code for a verified customer email |
| `POST` | `/api/v1/auth/login/verify-otp` | Verify `{ "email": "...", "otp": "123456" }` and create a customer session |
| `POST` | `/api/v1/auth/refresh` | Rotate a refresh token; reusing an old token revokes all account sessions |
| `POST` | `/api/v1/auth/logout`, `/logout-all` | Revoke this session or all sessions |
| `GET` | `/api/v1/auth/me`, `/sessions` | Get the customer profile and active sessions |
| `PATCH` | `/api/v1/auth/me` | Update first name, last name, or phone |
| `DELETE` | `/api/v1/auth/sessions/:sessionId` | Revoke one of the customer’s sessions |
| `GET`, `POST` | `/api/v1/auth/addresses` | List or add delivery addresses |
| `GET` | `/api/v1/auth/addresses/:addressId` | Get one of the customer’s own addresses |
| `PATCH`, `DELETE` | `/api/v1/auth/addresses/:addressId` | Edit or delete an owned delivery address |
| `PUT` | `/api/v1/auth/addresses/:addressId/default` | Make an owned address the default |
| `GET` | `/api/v1/auth/orders` | View the customer’s paginated order history; optional `status` filter |
| `POST` | `/api/v1/auth/deactivate` | Deactivate the current authenticated account |
| `DELETE` | `/api/v1/auth/account` | Anonymize and deactivate the current account |

Customer authentication is passwordless and currently email-only (SMTP); phone OTP requires a separate SMS provider and is not enabled. Register with `POST /api/v1/auth/register` using `{ "email": "customer@example.com" }` (optional `firstName` and `lastName` may also be supplied), then verify the emailed code. To sign in, post `{ "email": "customer@example.com" }` to `/api/v1/auth/login`, then submit the emailed six-digit code and email to `/api/v1/auth/login/verify-otp`. The verification response contains the access and refresh tokens. Unverified or unknown email addresses receive no sign-in code; the request response does not disclose whether an account exists.

Admin passwords remain bcrypt-hashed and admin password recovery is available under `/api/v1/admin/auth`. Access JWTs expire after 15 minutes; refresh tokens are random, single-use, HMAC-hashed at rest, and rotated on refresh. Email codes expire after the configured interval, allow at most five attempts, and can be requested once per minute. IP-based limits (10 login/sensitive-action, 5 email-challenge, and 30 refresh requests per 15 minutes) are persisted in PostgreSQL and shared across API instances.

Account deletion removes saved addresses and redacts shipping-address snapshots and notes on retained orders. Order and audit records remain for business history.

Customer address APIs are scoped to the authenticated customer. The first address becomes the default automatically; selecting or deleting the default keeps at most one default address and promotes another saved address when available. Customer email is not editable through profile updates because it is the passwordless sign-in identity.

## Customer administration

Admins with `customer:manage` can use:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/customers` | Paginated customer listing; supports `search`, `isActive`, `isEmailVerified`, `createdFrom`, and `createdTo` |
| `GET` | `/api/v1/admin/customers/stats` | Customer counts and store order totals |
| `GET` | `/api/v1/admin/customers/:userId` | Customer profile, addresses, and order count |
| `GET` | `/api/v1/admin/customers/:userId/orders` | Paginated order history; optional `status` |
| `PATCH` | `/api/v1/admin/customers/:userId/status` | Block/unblock via `{ "isActive": false }` or `true` |

Search matches customer email, name, or phone. Deactivating a customer revokes their active sessions.

## Product and category catalog

Public catalog reads are available without authentication:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/products` | Paginated product search/filter; supports `search`, `categoryId`, `brandId`, `featured`, `bestSeller`, `newArrival`, and `sort` |
| `GET` | `/api/v1/products/:slug` | Published product details, active variants, and related products |
| `GET` | `/api/v1/categories` | Active categories and child categories; optional `parentId` |
| `GET` | `/api/v1/categories/:slug` | Active category details and children |
| `GET` | `/api/v1/brands` | Active brands |

Admins with `catalog:manage` can manage:

- `/api/v1/admin/products` — `GET` (search/filter/paginate), `POST`, `GET /:productId`, `PATCH /:productId`, and `DELETE /:productId`.
- `/api/v1/admin/categories` — `GET`, `POST`, `GET /:categoryId`, `PATCH /:categoryId`, and `DELETE /:categoryId`.
- `/api/v1/admin/brands` — `GET`, `POST`, `GET /:brandId`, `PATCH /:brandId`, and `DELETE /:brandId`.
- `/api/v1/admin/products/:productId/images` — upload a product image; related endpoints update alt text, set the primary image, reorder, and delete images.

Create a draft product with `POST /api/v1/admin/products`, for example:

```json
{
  "sku": "TSHIRT-001",
  "title": "Cotton T-shirt",
  "slug": "cotton-t-shirt",
  "shortDescription": "Everyday cotton T-shirt",
  "sellingPrice": 799,
  "mrp": 999,
  "gstRate": 5,
  "hsnCode": "610910",
  "weightGrams": 220,
  "specifications": { "material": "Cotton" },
  "tags": ["cotton", "casual"],
  "variants": [
    { "sku": "TSHIRT-001-M-BLK", "size": "M", "color": "Black", "stock": 10 }
  ]
}
```

Products support SKU, title/slug, descriptions, MRP/selling price and derived discount percentage, GST/HSN, dimensions/weight, JSON specifications, tags, category/brand, featured/bestseller flags, stock, related product IDs, and size/color variants. New products default to unpublished; set `isActive: true` to publish. Supplying `variants` in a product `PATCH` replaces the complete sellable variant list; variants referenced by order history are retained as inactive inventory records so historic orders can still be restocked. `newArrival=true` means created within the last 30 days. Product and brand deletion are soft deletes; category deletion is refused while products or child categories remain.

New product images are stored locally under `uploads/products` in the project. Uploads accept one JPEG, PNG, WebP, AVIF, or GIF image per request, up to 10 MB, and each product can have up to 12 images. The file signature is checked before it is saved. The database stores a relative URL, local filename, format, size, alt text, ordering, and primary-image state. Public and admin product responses include the ordered `images` array. The upload directory is ignored by Git; back it up separately.

Existing images uploaded before this switch are preserved as their original URLs until deleted; they are not automatically copied to local storage. All new uploads and deletions of local images use the project’s local storage only.

Upload an image with an admin access token:

```sh
curl -X POST http://localhost:3000/api/v1/admin/products/PRODUCT_ID/images \
  -H "Authorization: Bearer ACCESS_TOKEN" \
  -F "image=@./product-front.jpg" \
  -F "altText=Front view of the product"
```

Use `PATCH /api/v1/admin/products/:productId/images/:imageId` with `{"altText":"..."}` to update alt text (`null` clears it), `PUT /api/v1/admin/products/:productId/images/:imageId/primary` to select the primary image, `PATCH /api/v1/admin/products/:productId/images/order` with `{"imageIds":["..."]}` to replace the complete image order, and `DELETE /api/v1/admin/products/:productId/images/:imageId` to remove one. Apply pending migrations with `npm run db:deploy` before using these endpoints. Profile photos, category images, and product videos remain unsupported.

## Shopping cart, wishlist, checkout, and orders

Cart routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/cart/guest` | Create a persistent guest cart; store the returned token securely |
| `GET` | `/api/v1/cart` | View customer or guest cart and server-calculated totals |
| `POST` | `/api/v1/cart/items` | Add `{ "productId":"...", "variantId":"...", "quantity":2 }` |
| `PATCH`, `DELETE` | `/api/v1/cart/items/:itemId` | Set a quantity or remove one cart item |
| `DELETE` | `/api/v1/cart` | Clear the cart |
| `POST` | `/api/v1/cart/merge` | Merge the guest cart into the authenticated customer cart |

For guest requests, send `X-Guest-Cart-Token` from the guest-cart response. Customer requests use the regular Bearer access token. After login, call `/api/v1/cart/merge` with both the access token and guest-cart token. Guest carts expire after 30 days. Cart quantities are checked against current stock; stock is not reserved until checkout.

Wishlist routes require customer authentication: `GET /api/v1/wishlist`, `POST /api/v1/wishlist` with `{ "productId":"..." }`, `DELETE /api/v1/wishlist/:productId`, and `POST /api/v1/wishlist/:productId/cart`. For products with variants, include `{"variantId":"..."}` when moving to cart.

Checkout and customer order routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/checkout` | Place an order from the signed-in customer cart |
| `GET` | `/api/v1/orders` | Paginated order history; optional `status` |
| `GET` | `/api/v1/orders/:orderId` | Order details, address snapshots, items, and status history |
| `POST` | `/api/v1/orders/:orderId/cancel` | Cancel before packing; inventory is restored transactionally |
| `POST` | `/api/v1/orders/:orderId/return` | Request a return within 7 days after delivery |
| `GET` | `/api/v1/orders/:orderId/invoice` | Download the generated PDF invoice |

Checkout accepts saved address IDs, `paymentMethod` (`COD` or `MANUAL`), and optional notes. The server reloads product and variant prices, GST, stock, and availability; frontend price and total fields are rejected. Product selling prices are treated as GST-inclusive, discounts are derived from MRP, and shipping is currently free (INR 0) until a shipping policy is configured. Inventory is locked and decremented in the same PostgreSQL transaction as order creation; failures roll back both.

Example checkout body:

```json
{
  "shippingAddressId": "SAVED_ADDRESS_UUID",
  "billingAddressId": "SAVED_ADDRESS_UUID",
  "paymentMethod": "COD",
  "notes": "Leave at the front desk"
}
```

Admins with `orders:manage` can list/filter and inspect orders at `/api/v1/admin/orders`, change status with `PATCH /api/v1/admin/orders/:orderId/status`, and download invoices. `payments:manage` is required for manual payment updates at `PATCH /api/v1/admin/orders/:orderId/payment-status`; payment changes are written to the admin activity log. Allowed lifecycle statuses are `PENDING`, `CONFIRMED`, `PROCESSING`, `PACKED`, `SHIPPED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `RETURN_REQUESTED`, `RETURNED`, `REFUND_PENDING`, and `REFUNDED`. Order status changes are recorded in history. A return is restocked only when an admin accepts/receives it by moving it to `RETURNED`. Payments are manually managed, with no gateway integration.

Apply the cart/order migration before use with `npm run db:deploy`, then regenerate Prisma Client with `npm run db:generate` if needed.

## Admin authentication and access control

There is no public admin registration endpoint. Create the initial SUPER_ADMIN only after migrations have run:

```sh
npm run admin:create-super-admin
```

The CLI prompts for the email/name and reads the password without echoing it. It refuses to create another bootstrap SUPER_ADMIN if one already exists. In a non-interactive environment, provide `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `BOOTSTRAP_ADMIN_FIRST_NAME`, and `BOOTSTRAP_ADMIN_LAST_NAME` through a secret manager, not command-line arguments.

Admin login and password recovery use `/api/v1/admin/auth/login`, `/forgot-password`, and `/reset-password`. Admin profile and session routes are under `/api/v1/admin/auth`. Authenticated admin APIs include:

- `/api/v1/admin/admins` — SUPER_ADMIN-only create/list/deactivate/delete and session revocation for ADMIN accounts.
- `/api/v1/admin/customers` — customer account listing and activation/deactivation for admins with `customer:manage`.
- `/api/v1/admin/audit/login-history` and `/api/v1/admin/audit/activity` — paginated audit records for admins with `audit:read`.

The migration seeds role permissions. ADMIN cannot manage administrative accounts; that permission is granted only to SUPER_ADMIN. Customer tokens are rejected by admin routes. Deactivated users’ sessions are revoked, and each admin/customer account-management action is recorded in the activity log.

## API foundation

- `GET /api/v1/health` — liveness check; does not depend on PostgreSQL.
- `GET /api/v1/health/ready` — readiness check; returns `503` if PostgreSQL is unavailable.
- Unknown routes and validation/runtime errors use a consistent JSON error response.
- Helmet sets security headers; CORS origins are configurable.

The API returns tokens in JSON. Clients should keep refresh tokens in secure storage and never expose them in URLs or logs. For browser deployments, use a backend-for-frontend with appropriately configured HttpOnly/Secure cookies and CSRF protection.

## Database architecture

The schema contains customer/admin accounts (customer password hashes are nullable; admins retain passwords), email verification/sign-in/password-reset challenges, refresh tokens, revocable sessions, role permissions, login/activity audit records, rate-limit buckets, addresses, product categories/products, persistent customer and guest carts, wishlists, and order/item/status-history snapshots. Orders support `COD` and manually managed payments only. No seller/vendor entity or multi-vendor model is present.

Apply migrations before starting a new deployment (`npm run db:deploy`) and regenerate Prisma Client after schema changes (`npm run db:generate`). The customer/catalog migration adds product and variant fields, brands, category hierarchy/SEO, related products, and the one-default-address-per-customer database constraint. The product image gallery is added in its own incremental migration.

## Quality checks

```sh
npm test
```
