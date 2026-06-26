export function normalizeDomain(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProtocol);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    return host || null;
  } catch {
    return null;
  }
}

export function projectScopedDomain(projectId: string): string {
  return `__project_${projectId}`;
}

export function isProjectScopedDomain(domain: string): boolean {
  return domain.startsWith("__project_");
}
