function extractDomain(url: string): string | null {
  try {
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    return new URL(normalized).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function labelForAgentActivity(
  toolName?: string,
  toolArgs?: Record<string, unknown>,
  activityKey?: "matchingPhotos"
): string {
  if (activityKey === "matchingPhotos") return "Matching your photos…";
  if (!toolName) return "Thinking…";

  switch (toolName) {
    case "ensureBrandKit":
    case "summarizeBusiness": {
      const url = typeof toolArgs?.url === "string" ? toolArgs.url : undefined;
      const domain = url ? extractDomain(url) : null;
      return domain ? `Reading ${domain}…` : "Reading website…";
    }
    case "setProjectLogo":
      return "Saving your logo…";
    case "saveContentReference":
      return "Saving your reference…";
    case "initBrandKit":
      return "Setting up brand from your description…";
    case "createTasks":
      return "Creating your posts…";
    default:
      return "Thinking…";
  }
}
