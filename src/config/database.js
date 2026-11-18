import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const databaseUrl = new URL(env.DATABASE_URL);
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 15_000,
  enableChannelBinding: ["require", "prefer"].includes(
    databaseUrl.searchParams.get("channel_binding"),
  ),
});

export const prisma = new PrismaClient({ adapter });
