"use client";

import { useCallback, useEffect, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import type { SettingsChangelogEntry } from "@/lib/brandKit/types";

export function SettingsChangelogPanel({
  projectId,
  refreshKey = 0,
}: {
  projectId: string;
  refreshKey?: number;
}) {
  const [changelog, setChangelog] = useState<SettingsChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/settings/changelog`);
      const data = (await res.json()) as { changelog?: SettingsChangelogEntry[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load changelog");
        return;
      }
      setChangelog(data.changelog ?? []);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const revert = useCallback(
    async (entryId: string) => {
      if (revertingId) return;
      setRevertingId(entryId);
      setError(null);
      try {
        const res = await fetch(
          `/api/projects/${projectId}/settings/changelog/${entryId}/revert`,
          { method: "POST" }
        );
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) {
          setError(data.error ?? "Could not revert change");
          return;
        }
        await load();
      } finally {
        setRevertingId(null);
      }
    },
    [projectId, revertingId, load]
  );

  return (
    <div className={`${GLASS_CARD} w-full max-w-3xl`}>
      <div className="px-5 py-4 border-b border-white/70">
        <h2 className="text-sm font-semibold text-slate-800">Settings changelog</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Agent and manual settings changes. Revert restores the exact before snapshot.
        </p>
      </div>
      <div className="p-5">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : changelog.length === 0 ? (
          <p className="text-sm text-slate-400">No settings changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {changelog.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-white/80 bg-white/50 px-4 py-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-800">{entry.summary}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {entry.source} · {new Date(entry.at).toLocaleString()}
                      {entry.revertedAt
                        ? ` · reverted ${new Date(entry.revertedAt).toLocaleString()}`
                        : ""}
                    </p>
                  </div>
                  {!entry.revertedAt ? (
                    <button
                      type="button"
                      disabled={revertingId === entry.id}
                      onClick={() => void revert(entry.id)}
                      className="shrink-0 text-xs font-medium text-violet-700 hover:text-violet-900 disabled:opacity-50"
                    >
                      {revertingId === entry.id ? "Reverting…" : "Revert"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                      Reverted
                    </span>
                  )}
                </div>
                <ul className="text-[10px] font-mono text-slate-500 space-y-0.5">
                  {entry.patches.map((p) => (
                    <li key={`${entry.id}-${p.path}`}>{p.path}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-xs text-red-600 mt-3">{error}</p> : null}
      </div>
    </div>
  );
}
