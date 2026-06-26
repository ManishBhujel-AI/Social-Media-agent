const TRANSIENT_RE =
  /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|ENOTFOUND|socket hang up|Connection terminated|connection lost|Client has encountered a connection error|Can't reach database server/i;

const TRANSIENT_PRISMA_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
]);

export function isTransientConnectionError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    const msg = String(err);
    return TRANSIENT_RE.test(msg);
  }

  const e = err as { message?: string; code?: string };
  if (e.code && TRANSIENT_PRISMA_CODES.has(e.code)) return true;
  if (e.code === "ECONNRESET" || e.code === "ETIMEDOUT") return true;
  if (e.message && TRANSIENT_RE.test(e.message)) return true;

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry DB/Redis operations that may fail on a brief connection blip. */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts?: { attempts?: number; label?: string }
): Promise<T> {
  const attempts = opts?.attempts ?? 4;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientConnectionError(err) || i === attempts - 1) throw err;
      const delay = 150 * (i + 1);
      console.warn(
        `[transient-retry] ${opts?.label ?? "operation"} attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err
      );
      await sleep(delay);
    }
  }

  throw lastErr;
}
