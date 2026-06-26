import { prisma } from "@/lib/db/prisma";
import { updateTaskFields } from "@/lib/tasks/taskEvents";
import { dispatchPipelineJob } from "./dispatch";
import { bootstrapImageCollectionIfStalled, resumeSubmittedStalledTasks } from "./pipelineGate";
import {
  isProjectPipelinePaused,
  setProjectPipelinePaused,
} from "./pipelinePauseFlag";
import type { TaskStatus } from "@prisma/client";

const IN_PROGRESS: TaskStatus[] = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
];

export { isProjectPipelinePaused, setProjectPipelinePaused };

export async function pauseProjectPipeline(projectId: string): Promise<number> {
  await setProjectPipelinePaused(projectId, true);

  const running = await prisma.task.findMany({
    where: { projectId, status: { in: IN_PROGRESS } },
  });

  for (const task of running) {
    await updateTaskFields(task.id, {
      statusLabel: "Paused",
      agentState: {
        ...((task.agentState as object) ?? {}),
        userPaused: true,
        pausedAtStatus: task.status,
      },
    });
  }

  return running.length;
}

export async function resumeProjectPipeline(projectId: string): Promise<number> {
  await setProjectPipelinePaused(projectId, false);

  const candidates = await prisma.task.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
  });

  let resumed = 0;
  for (const task of candidates) {
    const state = task.agentState as { userPaused?: boolean } | null;
    const wasPaused = task.statusLabel === "Paused" || state?.userPaused;
    if (!wasPaused) continue;

    await dispatchPipelineJob({
      type: "RESUME_TASK_AGENT",
      taskId: task.id,
      projectId,
      payload: { taskId: task.id, userReply: "", resumeCheckpoint: true },
    });
    resumed += 1;
  }

  if (resumed === 0) {
    await resumeSubmittedStalledTasks(projectId);
    await bootstrapImageCollectionIfStalled(projectId);
  }

  return resumed;
}

export async function assertPipelineNotPaused(projectId: string): Promise<boolean> {
  return !(await isProjectPipelinePaused(projectId));
}
