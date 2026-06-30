"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { GLASS_CARD, MESH_BG } from "@/lib/design/tokens";

type WorkspaceItem = {
  id: string;
  name: string;
  createdAt: string;
  taskCount: number;
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(iso)
  );
}

export function WorkspaceHome({ workspaces }: { workspaces: WorkspaceItem[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createWorkspace = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New workspace" }),
      });
      if (!res.ok) throw new Error("Failed to create workspace");
      const project = await res.json();
      router.push(`/project/${project.id}/chat`);
    } catch {
      setCreating(false);
    }
  }, [creating, router]);

  return (
    <div className={`fixed inset-0 overflow-auto ${MESH_BG} text-slate-800`}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-[34px] h-[34px] rounded-[11px] bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.4)] flex items-center justify-center">
            <div className="w-[13px] h-[13px] border-[2.5px] border-white rounded-[4px]" />
          </div>
          <div>
            <h1 className="text-[19px] font-bold tracking-tight">Brewline Content Studio</h1>
            <p className="text-sm text-slate-500">Pick a client workspace or create a new one</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 mb-6">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => router.push(`/project/${ws.id}/chat`)}
              className={`${GLASS_CARD} w-full text-left px-5 py-4 hover:bg-white/70 transition-colors`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{ws.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    Created {formatDate(ws.createdAt)}
                    {ws.taskCount > 0 ? ` · ${ws.taskCount} post${ws.taskCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <span className="text-violet-600 text-sm font-medium shrink-0">Open →</span>
              </div>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={createWorkspace}
          disabled={creating}
          className="w-full px-4 py-2.5 rounded-[11px] text-[13px] font-semibold text-white bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.34)] disabled:opacity-60"
        >
          {creating ? "Creating…" : "New workspace"}
        </button>
      </div>
    </div>
  );
}
