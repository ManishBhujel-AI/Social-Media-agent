"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MESH_BG } from "@/lib/design/tokens";
import type { BriefSummary } from "@/lib/types/brief";
import { BriefRow } from "@/components/shell/BriefRow";
import { ProjectStreamProvider } from "@/hooks/ProjectStreamProvider";
import { useProjectStream, type TaskStreamEvent } from "@/hooks/useProjectStream";
import type { TaskStatus } from "@prisma/client";

const TERMINAL_TASK_STATUSES: TaskStatus[] = ["NEEDS_APPROVAL", "APPROVED", "FAILED"];

function isPipelineActive(statuses: Iterable<TaskStatus>): boolean {
  for (const status of Array.from(statuses)) {
    if (!TERMINAL_TASK_STATUSES.includes(status)) return true;
  }
  return false;
}

const NAV = [
  { key: "chat", label: "Brief & Chat", icon: "✦", href: (id: string) => `/project/${id}/chat` },
  { key: "board", label: "Task Board", icon: "▦", href: (id: string) => `/project/${id}/board`, badge: "tasks" as const },
  { key: "approve", label: "Approvals", icon: "✓", href: (id: string) => `/project/${id}/approve`, badge: "needs" as const },
  { key: "settings", label: "Client Settings", icon: "⚙", href: (id: string) => `/project/${id}/settings` },
];

const HEADERS: Record<string, { title: string; sub: string }> = {
  chat: { title: "Brief & Chat", sub: "Tell the agent what to create" },
  board: { title: "Task Board", sub: "Track every post through the pipeline" },
  approve: { title: "Approvals", sub: "Posts waiting on your review" },
  settings: { title: "Client Settings", sub: "View and edit the brand kit for this client" },
  detail: { title: "Post Detail", sub: "Caption, graphic, and version history" },
};

export function AppShell({
  projectId,
  projectName,
  taskCount,
  needsCount,
  initialTaskStatuses,
  briefs,
  children,
}: {
  projectId: string;
  projectName: string;
  taskCount: number;
  needsCount: number;
  initialTaskStatuses: { id: string; status: TaskStatus }[];
  briefs: BriefSummary[];
  children: React.ReactNode;
}) {
  return (
    <ProjectStreamProvider projectId={projectId}>
      <AppShellInner
        projectId={projectId}
        projectName={projectName}
        taskCount={taskCount}
        needsCount={needsCount}
        initialTaskStatuses={initialTaskStatuses}
        briefs={briefs}
      >
        {children}
      </AppShellInner>
    </ProjectStreamProvider>
  );
}

function AppShellInner({
  projectId,
  projectName,
  taskCount,
  needsCount,
  initialTaskStatuses,
  briefs,
  children,
}: {
  projectId: string;
  projectName: string;
  taskCount: number;
  needsCount: number;
  initialTaskStatuses: { id: string; status: TaskStatus }[];
  briefs: BriefSummary[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [localBriefs, setLocalBriefs] = useState(briefs);
  const [liveCounts, setLiveCounts] = useState({ taskCount, needsCount });
  const [pollCounts, setPollCounts] = useState(() =>
    isPipelineActive(initialTaskStatuses.map((t) => t.status))
  );
  const taskStatusRef = useRef<Map<string, TaskStatus>>(
    new Map(initialTaskStatuses.map((t) => [t.id, t.status]))
  );

  useEffect(() => {
    taskStatusRef.current = new Map(initialTaskStatuses.map((t) => [t.id, t.status]));
    setLiveCounts({ taskCount, needsCount });
    setPollCounts(isPipelineActive(initialTaskStatuses.map((t) => t.status)));
  }, [projectId, initialTaskStatuses, taskCount, needsCount]);

  const onTaskEvent = useCallback((event: TaskStreamEvent) => {
    const { taskId, status } = event.payload;
    const prev = taskStatusRef.current.get(taskId);

    if (event.type === "task.created") {
      taskStatusRef.current.set(taskId, status);
      setLiveCounts((c) => ({
        taskCount: c.taskCount + 1,
        needsCount: c.needsCount + (status === "NEEDS_APPROVAL" ? 1 : 0),
      }));
      setPollCounts(isPipelineActive(taskStatusRef.current.values()));
      return;
    }

    if (prev === undefined) {
      taskStatusRef.current.set(taskId, status);
      setPollCounts(isPipelineActive(taskStatusRef.current.values()));
      return;
    }

    taskStatusRef.current.set(taskId, status);
    setLiveCounts((c) => {
      let nextNeeds = c.needsCount;
      if (prev !== "NEEDS_APPROVAL" && status === "NEEDS_APPROVAL") nextNeeds += 1;
      if (prev === "NEEDS_APPROVAL" && status !== "NEEDS_APPROVAL") nextNeeds -= 1;
      return { ...c, needsCount: nextNeeds };
    });
    setPollCounts(isPipelineActive(taskStatusRef.current.values()));
  }, []);

  const { agentActivity } = useProjectStream(projectId, { onTaskEvent });

  useEffect(() => {
    if (!pollCounts && !agentActivity) return;

    let cancelled = false;

    const refreshCounts = async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/counts?_=${Date.now()}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { taskCount: number; needsCount: number };
        setLiveCounts({ taskCount: data.taskCount, needsCount: data.needsCount });
      } catch {
        /* ignore */
      }
    };

    void refreshCounts();
    const id = window.setInterval(() => void refreshCounts(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [projectId, pollCounts, agentActivity]);

  useEffect(() => {
    setLocalBriefs(briefs);
  }, [briefs]);

  const handleRenamed = (id: string, name: string) => {
    setLocalBriefs((prev) => prev.map((b) => (b.id === id ? { ...b, name } : b)));
    router.refresh();
  };

  const handleDeleted = (id: string) => {
    const remaining = localBriefs.filter((b) => b.id !== id);
    setLocalBriefs(remaining);
    if (id === projectId) {
      if (remaining.length > 0) {
        router.push(`/project/${remaining[0].id}/chat`);
      } else {
        router.push("/");
      }
    }
    router.refresh();
  };

  async function createNewBrief() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New brief" }),
      });
      if (!res.ok) throw new Error(`Failed to create project: ${res.status}`);
      const project = await res.json();
      router.push(`/project/${project.id}/chat`);
    } catch (err) {
      console.error("New brief failed", err);
      setCreating(false);
    }
  }

  const screen = pathname.includes("/board")
    ? "board"
    : pathname.includes("/approve")
      ? "approve"
      : pathname.includes("/settings")
        ? "settings"
        : pathname.includes("/post/")
          ? "detail"
          : "chat";
  const header = HEADERS[screen] ?? HEADERS.chat;

  return (
    <div className={`fixed inset-0 flex overflow-hidden text-slate-800 ${MESH_BG}`}>
      <aside className="relative z-[2] w-[248px] flex-none flex flex-col px-4 py-[22px] bg-white/55 backdrop-blur-[22px] backdrop-saturate-150 border-r border-white/70 min-h-0">
        <div className="flex items-center gap-[11px] px-2 pb-[18px] flex-none">
          <div className="w-[34px] h-[34px] rounded-[11px] flex-none bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.4)] flex items-center justify-center">
            <div className="w-[13px] h-[13px] border-[2.5px] border-white rounded-[4px]" />
          </div>
          <div>
            <div className="text-[15px] font-bold tracking-tight">Brewline</div>
            <div className="text-[11px] text-slate-500 font-medium">Content Studio</div>
          </div>
        </div>

        <nav className="flex flex-col gap-[3px] flex-none">
          {NAV.map((n) => {
            const href = n.href(projectId);
            const active = pathname.startsWith(href);
            const badge =
              "badge" in n && n.badge === "tasks"
                ? liveCounts.taskCount
                : "badge" in n && n.badge === "needs"
                  ? liveCounts.needsCount
                  : 0;
            return (
              <Link
                key={n.key}
                href={href}
                className={`flex items-center gap-[11px] px-3 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors ${
                  active
                    ? "font-semibold text-slate-800 bg-white/85 shadow-[0_4px_14px_rgba(30,41,59,0.08)] border border-white/90"
                    : "text-slate-600 border border-transparent hover:bg-white/40"
                }`}
              >
                <span className={`w-[22px] text-center text-sm ${active ? "text-violet-600" : "text-slate-400"}`}>
                  {n.icon}
                </span>
                <span className="flex-1">{n.label}</span>
                {badge > 0 && (
                  <span className="text-[11px] font-semibold min-w-[19px] h-[19px] px-1.5 rounded-full inline-flex items-center justify-center bg-violet-500/15 text-violet-600">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 flex-1 min-h-0 flex flex-col">
          <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Briefs
          </div>
          <div className="flex-1 overflow-y-auto flex flex-col gap-0.5 pr-0.5 -mr-0.5">
            {localBriefs.map((brief) => (
              <BriefRow
                key={brief.id}
                brief={brief}
                active={brief.id === projectId}
                onRenamed={handleRenamed}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        </div>

        <div className="mt-3 flex-none p-3.5 rounded-2xl bg-white/50 border border-white/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[10px] flex-none bg-gradient-to-br from-amber-500 to-red-500 text-white text-[13px] font-bold flex items-center justify-center">
              RC
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold truncate">Rosa Calder</div>
              <div className="text-[11px] text-slate-500 truncate" title={projectName}>
                {projectName}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main className="relative z-[1] flex-1 min-w-0 flex flex-col overflow-hidden">
        <header className="flex-none flex items-center gap-4 px-[30px] py-[18px] border-b border-white/60 bg-white/40 backdrop-blur-[18px] backdrop-saturate-150">
          <div className="flex-1 min-w-0">
            <div className="text-[19px] font-bold tracking-tight">{header.title}</div>
            <div className="text-[13px] text-slate-500 mt-px truncate">{projectName}</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[11px] text-[13px] font-medium text-slate-600 bg-white/60 border border-white/85">
              <span className="w-[7px] h-[7px] rounded-full bg-green-500 shadow-[0_0_0_3px_rgba(34,197,94,0.18)]" />
              Agent online
            </div>
            <button
              type="button"
              onClick={createNewBrief}
              disabled={creating}
              className="px-4 py-2 rounded-[11px] text-[13px] font-semibold text-white cursor-pointer bg-gradient-to-br from-violet-500 to-violet-800 shadow-[0_6px_16px_rgba(124,58,237,0.34)] disabled:opacity-60"
            >
              {creating ? "Creating…" : "New brief"}
            </button>
          </div>
        </header>
        <div className="flex-1 min-h-0 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
