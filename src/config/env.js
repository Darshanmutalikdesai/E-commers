import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "DATABASE_URL must use the PostgreSQL protocol",
  ),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_ACCESS_SECRET: z.string().min(32),
  TOKEN_HASH_SECRET: z.string().min(32),
  REFRESH_SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  EMAIL_OTP_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  SMTP_HOST: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  SMTP_PORT: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  SMTP_USER: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  SMTP_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  SMTP_FROM: z.preprocess((value) => value === "" ? undefined : value, z.email().optional()),
}).superRefine((config, ctx) => {
  if (config.JWT_ACCESS_SECRET === config.TOKEN_HASH_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["TOKEN_HASH_SECRET"],
      message: "TOKEN_HASH_SECRET must differ from JWT_ACCESS_SECRET",
    });
  }

  const smtpValues = [
    config.SMTP_HOST,
    config.SMTP_PORT,
    config.SMTP_USER,
    config.SMTP_PASSWORD,
    config.SMTP_FROM,
  ];
  if (smtpValues.some(Boolean) && !smtpValues.every(Boolean)) {
    ctx.addIssue({
      code: "custom",
      message: "SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must be configured together",
    });
  }

});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const details = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = Object.freeze(result.data);
export const corsOrigins = Object.freeze(
  env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
);
