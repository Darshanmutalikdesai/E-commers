import "dotenv/config";
import bcrypt from "bcryptjs";
import { createInterface } from "node:readline/promises";
import { z } from "zod";
import { prisma } from "../src/config/database.js";

const passwordSchema = z.string()
  .min(12)
  .max(128)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72);
const inputSchema = z.object({
  email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
});

async function readPassword(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Provide all BOOTSTRAP_ADMIN_* values when running without an interactive terminal");
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Bootstrap cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(password);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          password = password.slice(0, -1);
        } else if (character >= " ") {
          password += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function collectInput() {
  const configured = {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
    firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME,
    lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME,
  };
  if (Object.values(configured).every(Boolean)) {
    return configured;
  }
  if (!process.stdin.isTTY) {
    throw new Error("Set all BOOTSTRAP_ADMIN_* environment variables when running without an interactive terminal");
  }

  const prompts = createInterface({ input: process.stdin, output: process.stdout });
  let email;
  let firstName;
  let lastName;
  try {
    email = await prompts.question("SUPER_ADMIN email: ");
    firstName = await prompts.question("First name: ");
    lastName = await prompts.question("Last name: ");
  } finally {
    prompts.close();
  }
  const password = await readPassword("Password (hidden): ");
  const confirmation = await readPassword("Confirm password (hidden): ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match");
  }
  return { email, password, firstName, lastName };
}

let rawInput;
try {
  rawInput = await collectInput();
} catch (error) {
  console.error(error.message);
  await prisma.$disconnect();
  process.exitCode = 1;
}

if (rawInput) {
  const input = inputSchema.safeParse(rawInput);
  if (!input.success) {
    console.error("Invalid bootstrap input. Use a valid email, names, and a password of 12-72 UTF-8 bytes.");
    await prisma.$disconnect();
    process.exitCode = 1;
  } else {
    try {
      await prisma.$transaction(async (tx) => {
        const [lock] = await tx.$queryRaw`
          SELECT pg_try_advisory_xact_lock(42220031, 1) AS acquired
        `;
        if (!lock.acquired) {
          throw new Error("Another SUPER_ADMIN bootstrap is in progress; retry shortly");
        }

        const existing = await tx.user.count({ where: { role: "SUPER_ADMIN", deletedAt: null } });
        if (existing > 0) {
          throw new Error("A SUPER_ADMIN already exists; refusing to create another bootstrap account");
        }

        await tx.user.create({
          data: {
            email: input.data.email,
            passwordHash: await bcrypt.hash(input.data.password, 12),
            firstName: input.data.firstName,
            lastName: input.data.lastName,
            role: "SUPER_ADMIN",
            isEmailVerified: true,
          },
        });
      }, {
        maxWait: 30_000,
        timeout: 30_000,
      });
      console.info("SUPER_ADMIN account created successfully");
    } catch (error) {
      console.error(error.code === "P2002"
        ? "An account with the supplied email already exists"
        : error.message);
      process.exitCode = 1;
    } finally {
      await prisma.$disconnect();
    }
  }
}
