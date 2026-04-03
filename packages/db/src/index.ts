import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __forgeflowPrisma: PrismaClient | undefined;
}

export const prisma =
  globalThis.__forgeflowPrisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__forgeflowPrisma = prisma;
}

export function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJsonField(value: unknown): string {
  return JSON.stringify(value ?? null);
}
