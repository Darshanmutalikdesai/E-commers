CREATE TYPE "AuthChallengeType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "LoginType" AS ENUM ('CUSTOMER', 'ADMIN');

ALTER TABLE "User"
    ADD COLUMN "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deletedAt" TIMESTAMPTZ(3);

ALTER TABLE "RefreshToken" ADD COLUMN "sessionId" UUID;

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "userAgent" VARCHAR(500),
    "ipAddress" VARCHAR(64),
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokeReason" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AuthChallengeType" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Permission" (
    "id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RolePermission" (
    "role" "UserRole" NOT NULL,
    "permissionId" UUID NOT NULL,
    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("role", "permissionId")
);

CREATE TABLE "LoginHistory" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "email" VARCHAR(320) NOT NULL,
    "role" "UserRole",
    "loginType" "LoginType" NOT NULL,
    "successful" BOOLEAN NOT NULL,
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminActivityLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "targetUserId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "details" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminActivityLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuthRateLimitBucket" (
    "key" CHAR(64) NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "AuthRateLimitBucket_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "AuthChallenge_tokenHash_key" ON "AuthChallenge"("tokenHash");
CREATE INDEX "AuthSession_userId_revokedAt_expiresAt_idx" ON "AuthSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "AuthChallenge_userId_type_consumedAt_expiresAt_idx" ON "AuthChallenge"("userId", "type", "consumedAt", "expiresAt");
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");
CREATE INDEX "LoginHistory_userId_createdAt_idx" ON "LoginHistory"("userId", "createdAt");
CREATE INDEX "LoginHistory_email_createdAt_idx" ON "LoginHistory"("email", "createdAt");
CREATE INDEX "LoginHistory_loginType_createdAt_idx" ON "LoginHistory"("loginType", "createdAt");
CREATE INDEX "AdminActivityLog_actorId_createdAt_idx" ON "AdminActivityLog"("actorId", "createdAt");
CREATE INDEX "AdminActivityLog_targetUserId_createdAt_idx" ON "AdminActivityLog"("targetUserId", "createdAt");
CREATE INDEX "AuthRateLimitBucket_resetAt_idx" ON "AuthRateLimitBucket"("resetAt");
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthChallenge" ADD CONSTRAINT "AuthChallenge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey"
    FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AdminActivityLog" ADD CONSTRAINT "AdminActivityLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminActivityLog" ADD CONSTRAINT "AdminActivityLog_targetUserId_fkey"
    FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Permission" ("id", "key", "description") VALUES
    (gen_random_uuid(), 'admin:manage', 'Create, update, and disable administrative accounts'),
    (gen_random_uuid(), 'customer:manage', 'View and manage customer account status'),
    (gen_random_uuid(), 'audit:read', 'Read administrative login and activity audit logs'),
    (gen_random_uuid(), 'catalog:manage', 'Manage the product catalog'),
    (gen_random_uuid(), 'orders:manage', 'Manage customer orders'),
    (gen_random_uuid(), 'payments:manage', 'Manage manual payment status');

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT 'SUPER_ADMIN'::"UserRole", "id" FROM "Permission";

INSERT INTO "RolePermission" ("role", "permissionId")
SELECT 'ADMIN'::"UserRole", "id" FROM "Permission"
WHERE "key" <> 'admin:manage';
