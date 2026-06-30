"use client";

import { useCallback, useEffect, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";

export function CaptionCorpusPanel({ projectId }: { projectId: string }) {
  const [corpus, setCorpus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/caption-corpus`);
      if (!res.ok) throw new Error("load failed");
      const data = (await res.json()) as { corpus: string };
      setCorpus(data.corpus ?? "");
    } catch {
      setError("Could not load saved captions");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/caption-corpus`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpus }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        corpus?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "save failed");
      }
      setCorpus(data.corpus ?? "");
      setMessage("Saved.");
    } catch (err) {
      setError(
        err instanceof Error && err.message !== "save failed"
          ? err.message
          : "Could not save — refresh and try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${GLASS_CARD} w-full max-w-2xl p-5 mb-5`}>
      <div className="text-xs font-semibold text-slate-400 mb-1">CLIENT CONTENT</div>
      <h2 className="text-[17px] font-bold text-slate-800 mb-2">Past captions</h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">
        Paste approved past captions for this client. Post creation uses them as style reference —
        not to copy verbatim.
      </p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <textarea
          value={corpus}
          onChange={(e) => setCorpus(e.target.value)}
          rows={16}
          placeholder={`Paste captions here — separate posts with a blank line or ---\n\nExample:\n🎉 Summer Kick-Off is here...\n#CoscoHawaii #HawaiiHVAC\n\n---\n\nCelebrating 65 years...`}
          className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
        />
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void save()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save captions"}
        </button>
        {message ? <p className="text-[12px] text-emerald-600">{message}</p> : null}
        {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
