"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export function ChatConversationBar({
  projectId,
  conversations,
  activeConversationId,
}: {
  projectId: string;
  conversations: { id: string; createdAt: string; messageCount: number }[];
  activeConversationId: string;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const switchConversation = useCallback(
    (conversationId: string) => {
      router.push(`/project/${projectId}/chat?conversation=${conversationId}`);
    },
    [projectId, router]
  );

  const newChat = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/conversations`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to create chat");
      const data = (await res.json()) as { id: string };
      router.push(`/project/${projectId}/chat?conversation=${data.id}`);
      router.refresh();
    } catch {
      setCreating(false);
    }
  }, [creating, projectId, router]);

  const deleteChat = useCallback(
    async (conversationId: string) => {
      if (deletingId) return;
      setDeletingId(conversationId);
      setDeleteError(null);
      try {
        const res = await fetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Failed to delete chat");

        setConfirmDeleteId(null);

        if (conversationId === activeConversationId) {
          const remaining = conversations
            .filter((c) => c.id !== conversationId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          if (remaining.length > 0) {
            router.push(`/project/${projectId}/chat?conversation=${remaining[0].id}`);
          } else {
            router.push(`/project/${projectId}/chat`);
          }
        }
        router.refresh();
      } catch {
        setDeleteError("Could not delete chat. Try again.");
      } finally {
        setDeletingId(null);
      }
    },
    [activeConversationId, conversations, deletingId, projectId, router]
  );

  useEffect(() => {
    if (!confirmDeleteId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmDeleteId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDeleteId]);

  const sorted = [...conversations].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const confirmIndex = confirmDeleteId
    ? sorted.findIndex((c) => c.id === confirmDeleteId)
    : -1;
  const confirmLabel = confirmIndex >= 0 ? `Chat ${sorted.length - confirmIndex}` : "this chat";

  return (
    <>
      <div className="flex items-center gap-2 px-7 py-2.5 border-b border-white/60 bg-white/30 text-xs">
        <span className="text-slate-500 font-medium shrink-0">Chats</span>
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto">
          {sorted.map((c, index) => {
            const label = `Chat ${sorted.length - index}`;
            const active = c.id === activeConversationId;
            return (
              <div key={c.id} className="relative shrink-0 group/tab">
                <div
                  className={`inline-flex items-center rounded-lg border text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-violet-500/15 border-violet-400/40 text-violet-800"
                      : "bg-white/50 border-white/80 text-slate-600"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => switchConversation(c.id)}
                    className={`px-2.5 py-1 hover:bg-white/40 rounded-l-lg transition-colors ${
                      active ? "" : "hover:bg-white/80"
                    }`}
                  >
                    {label}
                    {c.messageCount > 0 ? ` (${c.messageCount})` : ""}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteError(null);
                      setConfirmDeleteId(c.id);
                    }}
                    className="px-1 py-1 text-slate-400 hover:text-red-600 leading-none text-sm rounded-r-lg hover:bg-red-500/8 opacity-60 group-hover/tab:opacity-100 focus:opacity-100"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={newChat}
          disabled={creating}
          className="shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-violet-700 bg-white/70 border border-violet-300/50 hover:bg-white disabled:opacity-50"
        >
          {creating ? "…" : "New chat"}
        </button>
      </div>

      {confirmDeleteId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20"
          onClick={() => {
            if (!deletingId) setConfirmDeleteId(null);
          }}
        >
          <div
            className="w-full max-w-[280px] rounded-2xl bg-white/90 backdrop-blur-xl border border-white/90 shadow-[0_16px_40px_rgba(30,41,59,0.18)] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium text-slate-800 mb-1">Delete {confirmLabel}?</p>
            <p className="text-[12px] leading-snug text-slate-600 mb-4">
              This chat, its messages, and any posts created in this chat will be permanently
              removed from the task board and approvals.
            </p>
            {deleteError && (
              <p className="mb-3 text-[11px] text-red-700">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => deleteChat(confirmDeleteId)}
                className="flex-1 py-2 rounded-xl text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50"
              >
                {deletingId ? "Deleting…" : "Delete chat"}
              </button>
              <button
                type="button"
                disabled={Boolean(deletingId)}
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-2 rounded-xl text-[12px] font-semibold text-slate-600 bg-white/80 border border-white/90 hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
