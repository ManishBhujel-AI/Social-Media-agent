"use client";

import { useCallback, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import type { SettingsPatchItem } from "@/lib/brandKit/types";

export type SettingsProposal = {
  summary: string;
  patches: SettingsPatchItem[];
  source?: "agent" | "user";
};

export function SettingsProposalCard({
  projectId,
  messageId,
  proposal,
  onApplied,
  onDeclined,
}: {
  projectId: string;
  messageId?: string;
  proposal: SettingsProposal;
  onApplied?: (entryId: string) => void;
  onDeclined?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markProposalStatus = useCallback(
    async (status: "applied" | "declined", changelogEntryId?: string) => {
      if (!messageId) return;
      await fetch(`/api/messages/${messageId}/settings-proposal`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, changelogEntryId }),
      });
    },
    [messageId]
  );

  const confirm = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: proposal.summary,
          source: proposal.source ?? "agent",
          patches: proposal.patches,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        entry?: { id: string };
      };
      if (!res.ok || data.error) {
        setError(data.error ?? "Could not apply settings change");
        return;
      }
      await markProposalStatus("applied", data.entry?.id);
      onApplied?.(data.entry?.id ?? "");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, projectId, proposal, onApplied, markProposalStatus]);

  const decline = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await markProposalStatus("declined");
      onDeclined?.();
    } finally {
      setSubmitting(false);
    }
  }, [submitting, onDeclined, markProposalStatus]);

  return (
    <div className={`${GLASS_CARD} max-w-lg overflow-hidden ring-2 ring-amber-400/35`}>
      <div className="px-4 py-3 border-b border-white/70 bg-amber-500/10">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
          Save to client settings?
        </div>
      </div>
      <div className="p-4 flex flex-col gap-3">
        <p className="text-sm text-slate-700 leading-relaxed">{proposal.summary}</p>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer hover:text-slate-700">View patch details</summary>
          <pre className="mt-2 p-2 rounded-lg bg-slate-900/5 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(proposal.patches, null, 2)}
          </pre>
        </details>
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="flex-1 px-3 py-2 rounded-xl text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={decline}
            disabled={submitting}
            className="px-3 py-2 rounded-xl text-sm font-medium bg-white/80 border border-slate-200 text-slate-600 hover:bg-white disabled:opacity-50"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
