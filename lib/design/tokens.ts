export type StatusKey =
  | "notstarted"
  | "progress"
  | "needsinfo"
  | "needs"
  | "changes"
  | "approved"
  | "failed";

export const STATUS_META: Record<
  StatusKey,
  { label: string; fg: string; bg: string; dot: string }
> = {
  notstarted: {
    label: "Not started",
    fg: "#64748b",
    bg: "rgba(100,116,139,0.13)",
    dot: "#94a3b8",
  },
  progress: {
    label: "In progress",
    fg: "#2563eb",
    bg: "rgba(37,99,235,0.13)",
    dot: "#3b82f6",
  },
  needsinfo: {
    label: "Needs info",
    fg: "#c2410c",
    bg: "rgba(234,88,12,0.14)",
    dot: "#ea580c",
  },
  needs: {
    label: "Needs approval",
    fg: "#b45309",
    bg: "rgba(245,158,11,0.16)",
    dot: "#f59e0b",
  },
  changes: {
    label: "Changes requested",
    fg: "#7c3aed",
    bg: "rgba(124,58,237,0.14)",
    dot: "#8b5cf6",
  },
  approved: {
    label: "Approved",
    fg: "#15803d",
    bg: "rgba(34,197,94,0.15)",
    dot: "#22c55e",
  },
  failed: {
    label: "Failed",
    fg: "#dc2626",
    bg: "rgba(239,68,68,0.14)",
    dot: "#ef4444",
  },
};

/** Statuses that show the in-progress spinner on the board. */
export const IN_PROGRESS_STATUSES = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
] as const;

export function taskStatusToKey(status: string): StatusKey {
  switch (status) {
    case "NOT_STARTED":
      return "notstarted";
    case "AGENT_RUNNING":
    case "WRITING_CAPTION":
    case "WRITING_PROMPT":
    case "GENERATING_IMAGE":
      return "progress";
    case "NEEDS_INFO":
      return "needsinfo";
    case "NEEDS_APPROVAL":
      return "needs";
    case "CHANGES_REQUESTED":
      return "changes";
    case "APPROVED":
      return "approved";
    case "FAILED":
      return "failed";
    default:
      return "notstarted";
  }
}

export function taskSubLabel(
  status: string,
  opts?: { statusLabel?: string | null; pendingQuestion?: string | null }
): string | null {
  if (opts?.statusLabel) return opts.statusLabel;

  if (status === "NEEDS_INFO" && opts?.pendingQuestion) {
    const q = opts.pendingQuestion;
    return q.length > 72 ? `${q.slice(0, 69)}…` : q;
  }

  switch (status) {
    case "AGENT_RUNNING":
      return "Creating post…";
    case "WRITING_CAPTION":
      return "Creating post — writing caption…";
    case "WRITING_PROMPT":
      return "Creating post — planning visual…";
    case "GENERATING_IMAGE":
      return "Creating post — designing graphic…";
    case "NEEDS_INFO":
      return "Waiting for photo…";
    case "FAILED":
      return "Failed — retry";
    default:
      return null;
  }
}

export const GLASS_CARD =
  "bg-white/60 backdrop-blur-xl backdrop-saturate-150 border border-white/80 rounded-[22px] shadow-[0_18px_44px_rgba(30,41,59,0.10)]";

/** Page content padding — matches design shell */
export const PAGE_PADDING = "p-[26px_30px]";

/** App shell mesh background (see globals.css `.mesh-bg`) */
export const MESH_BG = "mesh-bg";
