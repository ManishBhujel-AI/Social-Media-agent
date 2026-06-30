import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function resolveDatabaseUrl(): string {
  // Long-running local dev holds connections open — Neon direct URL avoids pooler timeouts.
  const raw =
    process.env.NODE_ENV === "development" && process.env.DIRECT_URL?.trim()
      ? process.env.DIRECT_URL.trim()
      : process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  try {
    const url = new URL(raw);
    const isPooled = url.hostname.includes("-pooler");
    if (!url.searchParams.has("connection_limit")) {
      const limit =
        process.env.PRISMA_CONNECTION_LIMIT ??
        (process.env.PIPELINE_WORKER === "1" ? "3" : isPooled ? "5" : "10");
      url.searchParams.set("connection_limit", limit);
    }
    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set(
        "pool_timeout",
        process.env.NODE_ENV === "development" ? "60" : "30"
      );
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    datasources: {
      db: { url: resolveDatabaseUrl() },
    },
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
