export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export function mergeAbortSignals(
  signals: (AbortSignal | undefined)[],
  timeoutMs?: number
): AbortSignal {
  const controllers: AbortController[] = [];
  const merged = new AbortController();

  const abortMerged = (reason?: unknown) => {
    if (merged.signal.aborted) return;
    merged.abort(reason ?? new DOMException("Aborted", "AbortError"));
  };

  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      abortMerged(signal.reason);
      return merged.signal;
    }
    signal.addEventListener("abort", () => abortMerged(signal.reason), { once: true });
  }

  if (timeoutMs != null && timeoutMs > 0) {
    const timeout = setTimeout(
      () => abortMerged(new DOMException("Timeout", "TimeoutError")),
      timeoutMs
    );
    merged.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
  }

  return merged.signal;
}
