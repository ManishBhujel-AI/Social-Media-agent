import { prisma } from "@/lib/db/prisma";
import type { AgentLoopState } from "../agentLoop";
import { writeCaptionForTask, makeGraphicForTask } from "./graphicAgent";
import { getTaskDeliverableStatus } from "@/lib/tasks/deliverable";
import { getForProject } from "@/lib/brandKit/store";
import { updateTaskFields, updateTaskLabel } from "@/lib/tasks/taskEvents";
import {
  hasMarketingReadySummary,
  isProductDescriptionQuestion,
  type ProductSummary,
} from "../productContext";
import { isAgentQuestionPause } from "@/lib/tasks/taskPauseState";

const STATUS_LABELS = {
  writeCaption: "Creating post — writing caption, graphic copy & scene…",
  makeGraphic: "Creating post — designing graphic…",
} as const;

export function isReadyForCaptionCheckpoint(state: AgentLoopState | null): boolean {
  if (!state?.messages?.length) return false;
  const last = state.messages[state.messages.length - 1];
  if (last.role !== "tool" || last.name !== "findProduct") return false;
  const content = typeof last.content === "string" ? last.content : "";
  try {
    const parsed = JSON.parse(content) as { readyForCaption?: boolean; found?: boolean };
    return parsed.readyForCaption === true || parsed.found === true;
  } catch {
    return false;
  }
}

/** Skip the chat agent when research is done — write caption and graphic directly. */
export async function finishPostFromResearchCheckpoint(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const brandKit = await getForProject(task.projectId);
  if (!brandKit?.complete) return false;

  if (!task.caption?.trim()) {
    await updateTaskLabel(taskId, STATUS_LABELS.writeCaption);
    await writeCaptionForTask(taskId);
  }

  const afterCaption = await prisma.task.findUnique({
    where: { id: taskId },
    include: { generations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!afterCaption?.caption?.trim()) return false;
  if (afterCaption.generations[0]?.imagePath) {
    return (await getTaskDeliverableStatus(taskId)).ok;
  }

  await updateTaskLabel(taskId, STATUS_LABELS.makeGraphic);
  await makeGraphicForTask(taskId);
  return (await getTaskDeliverableStatus(taskId)).ok;
}

/** Unstick posts that asked for a description even though Perplexity research already saved. */
export async function healDescriptionPauseWithReadyResearch(projectId: string): Promise<number> {
  const candidates = await prisma.task.findMany({
    where: { projectId, status: "NEEDS_INFO" },
    orderBy: { orderIndex: "asc" },
  });

  let healed = 0;
  for (const task of candidates) {
    if (!isAgentQuestionPause(task)) continue;
    if (!isProductDescriptionQuestion(task.pendingQuestion)) continue;
    if (!hasMarketingReadySummary(task.productSummary as ProductSummary | null)) continue;

    await updateTaskFields(task.id, {
      status: "AGENT_RUNNING",
      statusLabel: "Creating post — research ready, writing…",
      pendingQuestion: null,
    });

    try {
      const finished = await finishPostFromResearchCheckpoint(task.id);
      if (!finished) continue;
      await updateTaskFields(task.id, {
        status: "NEEDS_APPROVAL",
        statusLabel: null,
        pendingQuestion: null,
      });
      healed += 1;
    } catch (err) {
      console.warn(`[healDescriptionPause] failed for ${task.id}:`, err);
      await updateTaskFields(task.id, {
        status: "NEEDS_INFO",
        statusLabel: "Creating post — need your input…",
        pendingQuestion: task.pendingQuestion,
      });
    }
  }

  return healed;
}
