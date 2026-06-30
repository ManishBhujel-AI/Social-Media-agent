"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GLASS_CARD, MESH_BG } from "@/lib/design/tokens";

export function HomeEmpty() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function createFirstBrief() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New workspace" }),
      });
      if (!res.ok) throw new Error("Failed to create brief");
      const project = await res.json();
      router.push(`/project/${project.id}/chat`);
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className={`fixed inset-0 flex items-center justify-center ${MESH_BG} text-slate-800`}>
      <div className={`${GLASS_CARD} w-full max-w-md mx-6 p-8 text-center`}>
        <div className="w-[34px] h-[34px] mx-auto rounded-[11px] bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.4)] flex items-center justify-center">
          <div className="w-[13px] h-[13px] border-[2.5px] border-white rounded-[4px]" />
        </div>
        <h1 className="mt-5 text-[19px] font-bold tracking-tight">Brewline Content Studio</h1>
        <p className="mt-2 text-sm text-slate-500 leading-relaxed">
          No workspaces yet. Create one to start planning posts with the agent.
        </p>
        <button
          type="button"
          onClick={createFirstBrief}
          disabled={creating}
          className="mt-6 w-full px-4 py-2.5 rounded-[11px] text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.34)] disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create your first workspace"}
        </button>
      </div>
    </div>
  );
}
