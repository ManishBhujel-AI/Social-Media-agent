"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { BriefSummary } from "@/lib/types/brief";

function formatBriefDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
}

export function BriefRow({
  brief,
  active,
  onRenamed,
  onDeleted,
}: {
  brief: BriefSummary;
  active: boolean;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [nameDraft, setNameDraft] = useState(brief.name);
  const [busy, setBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNameDraft(brief.name);
  }, [brief.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const saveRename = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === brief.name) {
      setRenaming(false);
      setNameDraft(brief.name);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${brief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        onRenamed(brief.id, data.name);
        setRenaming(false);
      }
    } finally {
      setBusy(false);
      setMenuOpen(false);
    }
  };

  const deleteBrief = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${brief.id}`, { method: "DELETE" });
      if (res.ok) {
        onDeleted(brief.id);
      }
    } finally {
      setBusy(false);
      setMenuOpen(false);
      setConfirmDelete(false);
    }
  };

  if (renaming) {
    return (
      <div
        className={`px-3 py-2 rounded-xl border ${
          active ? "bg-violet-500/12 border-violet-500/25" : "bg-white/50 border-white/80"
        }`}
      >
        <input
          className="w-full text-[13px] font-medium bg-white/80 border border-white/90 rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-400/40"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveRename();
            if (e.key === "Escape") {
              setRenaming(false);
              setNameDraft(brief.name);
            }
          }}
          autoFocus
          disabled={busy}
        />
        <div className="flex gap-1.5 mt-2">
          <button
            type="button"
            onClick={saveRename}
            disabled={busy}
            className="flex-1 py-1 rounded-lg text-[11px] font-semibold text-white bg-violet-600 disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setRenaming(false);
              setNameDraft(brief.name);
            }}
            disabled={busy}
            className="flex-1 py-1 rounded-lg text-[11px] font-semibold text-slate-600 bg-white/70 border border-white/90"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group relative flex items-stretch rounded-xl transition-colors ${
        active
          ? "bg-violet-500/12 border border-violet-500/25"
          : "border border-transparent hover:bg-white/50"
      }`}
    >
      <Link
        href={`/project/${brief.id}/chat`}
        className="flex-1 min-w-0 flex flex-col gap-0.5 px-3 py-2 pr-1 text-left"
      >
        <span
          className={`text-[13px] font-medium truncate ${
            active ? "text-violet-800 font-semibold" : "text-slate-700"
          }`}
        >
          {brief.name}
        </span>
        <span className="text-[10.5px] text-slate-400">
          {formatBriefDate(brief.createdAt)}
          {brief.taskCount > 0
            ? ` · ${brief.taskCount} post${brief.taskCount === 1 ? "" : "s"}`
            : ""}
        </span>
      </Link>

      <div ref={menuRef} className="relative flex items-start pt-1.5 pr-1.5 flex-none">
        <button
          type="button"
          aria-label="Brief options"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenuOpen((o) => !o);
            setConfirmDelete(false);
          }}
          className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white/70 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-base leading-none"
        >
          ⋯
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[148px] py-1 rounded-xl bg-white/75 backdrop-blur-xl backdrop-saturate-150 border border-white/90 shadow-[0_10px_28px_rgba(30,41,59,0.12)]">
            {confirmDelete ? (
              <div className="px-3 py-2">
                <p className="text-[11px] leading-snug text-slate-600 mb-2">
                  Delete this brief and all posts?
                </p>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={deleteBrief}
                    className="flex-1 py-1 rounded-lg text-[11px] font-semibold text-white bg-red-500 disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1 py-1 rounded-lg text-[11px] font-semibold text-slate-600 bg-white/80 border border-white/90"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-white/60"
                  onClick={() => {
                    setMenuOpen(false);
                    setRenaming(true);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-[12px] font-medium text-red-600 hover:bg-red-500/8"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete…
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
