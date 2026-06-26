"use client";

import { useCallback, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";

export function ProjectResearchSettings({
  projectId,
  initialAlwaysWebResearch,
}: {
  projectId: string;
  initialAlwaysWebResearch: boolean;
}) {
  const [enabled, setEnabled] = useState(initialAlwaysWebResearch);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const save = useCallback(
    async (next: boolean) => {
      setSaving(true);
      setMessage(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/research-settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alwaysWebResearch: next }),
        });
        if (!res.ok) throw new Error("Could not save");
        setEnabled(next);
        setMessage("Saved");
      } catch {
        setMessage("Could not save — try again");
        setEnabled((prev) => !next);
      } finally {
        setSaving(false);
      }
    },
    [projectId]
  );

  return (
    <div className={`${GLASS_CARD} w-full max-w-2xl p-5 mb-5`}>
      <div className="text-xs font-semibold text-slate-400 mb-1">PRODUCT RESEARCH</div>
      <h2 className="text-[17px] font-bold text-slate-800 mb-2">Web research (Perplexity)</h2>
      <p className="text-sm text-slate-600 leading-relaxed mb-4">
        By default, web research runs only when site data, captions, and photos aren&apos;t enough
        for a marketing brief. Turn this on to run Perplexity on every post — useful for thin
        briefs; usually unnecessary when you paste approved captions.
      </p>
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          checked={enabled}
          disabled={saving}
          onChange={(e) => {
            const next = e.target.checked;
            setEnabled(next);
            void save(next);
          }}
        />
        <span className="text-sm text-slate-700">
          <span className="font-semibold text-slate-800">Always run web research per post</span>
          <span className="block text-[12px] text-slate-500 mt-0.5">
            Adds Perplexity Sonar cost; results show on each board card.
          </span>
        </span>
      </label>
      {message ? <p className="mt-3 text-[12px] text-slate-500">{message}</p> : null}
    </div>
  );
}
