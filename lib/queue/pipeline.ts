import { prisma } from "@/lib/db/prisma";
import { dispatchPipelineJob } from "./dispatch";
import { isProjectPipelineBlocked } from "./pipelineGate";

export async function startPipelineForTasks(taskIds: string[]) {
  if (taskIds.length === 0) return;
  const task = await prisma.task.findUnique({ where: { id: taskIds[0] } });
  if (!task) return;

  if (await isProjectPipelineBlocked(task.projectId)) {
    return;
  }

  await dispatchPipelineJob({
    type: "RUN_TASK_AGENT",
    taskId: taskIds[0],
    projectId: task?.projectId,
    payload: { taskId: taskIds[0], remainingTaskIds: taskIds.slice(1) },
  });
}

/** Only call when a task reaches NEEDS_APPROVAL or FAILED — never on NEEDS_INFO. */
export async function enqueueNextTask(remainingTaskIds: string[]) {
  if (remainingTaskIds.length === 0) return;
  const task = await prisma.task.findUnique({ where: { id: remainingTaskIds[0] } });
  if (!task) return;

  if (await isProjectPipelineBlocked(task.projectId)) {
    return;
  }

  await dispatchPipelineJob({
    type: "RUN_TASK_AGENT",
    taskId: remainingTaskIds[0],
    projectId: task?.projectId,
    payload: { taskId: remainingTaskIds[0], remainingTaskIds: remainingTaskIds.slice(1) },
  });
}
