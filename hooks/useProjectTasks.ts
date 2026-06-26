"use client";

import { useEffect, useRef, type SetStateAction } from "react";
import type { TaskWithMeta } from "@/lib/tasks/taskStream";
import { useProjectStreamContext } from "@/hooks/ProjectStreamProvider";

/** Shared task list for Chat + Board — hydrated from SSR, kept live via SSE and refresh. */
export function useProjectTasks(initialTasks: TaskWithMeta[]) {
  const ctx = useProjectStreamContext();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!ctx) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    ctx.hydrateProjectTasks(initialTasks);
  }, [ctx, initialTasks]);

  if (!ctx) {
    return {
      tasks: initialTasks,
      setTasks: (_: SetStateAction<TaskWithMeta[]>) => {},
      refreshTasks: async () => [] as TaskWithMeta[],
    };
  }

  return {
    tasks: ctx.tasks.length > 0 ? ctx.tasks : initialTasks,
    setTasks: ctx.setTasks,
    refreshTasks: ctx.refreshTasks,
  };
}
