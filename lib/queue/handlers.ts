import { prisma } from "@/lib/db/prisma";
import { emitProjectEvent } from "@/lib/events/emit";
import { runCaptionWithFeedback } from "@/lib/ai/agents/captionAgent";
import { refineFeedback } from "@/lib/ai/agents/promptRefiner";
import { resolveFeedbackReferenceImages } from "@/lib/ai/feedbackReferences";
import { editImage, regenerateImage } from "@/lib/ai/agents/imageAgent";
import { analyzeImages } from "@/lib/ai/agents/visionAgent";
import { runPostAgent, resumePostAgent, continuePostAgentAfterImageRequest, continuePostAgentFromSavedState } from "@/lib/ai/agents/postAgent";
import { isPreImageRequestState } from "@/lib/ai/agents/postImageRequest";
import { updateTaskStatus, emitTaskDeliverableUpdated } from "@/lib/tasks/taskEvents";
import { enqueueNextTask } from "./pipeline";
import {
  advanceImageCollectionQueue,
  filterNotStartedTaskIds,
} from "./pipelineGate";
import { isRetryable } from "@/lib/ai/errors";
import { isTransientConnectionError } from "@/lib/db/transientRetry";
import type { TaskStatus } from "@prisma/client";

async function failTask(taskId: string, error: string) {
  await updateTaskStatus(taskId, "FAILED", { statusLabel: "Failed — retry" });
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (task) {
    await emitProjectEvent({
      type: "job.failed",
      projectId: task.projectId,
      payload: { taskId, error },
    });
  }
}

export async function processJob(name: string, data: Record<string, unknown>) {
  switch (name) {
    case "ANALYZE_IMAGES": {
      const { projectId, imageIds } = data as { projectId: string; imageIds: string[] };
      const matches = await analyzeImages(projectId, imageIds);
      await prisma.project.update({
        where: { id: projectId },
        data: { visionMatches: matches as object },
      });
      for (const match of matches) {
        await prisma.uploadedImage.updateMany({
          where: { id: match.imageId, projectId },
          data: {
            matchedProduct: match.matchedProduct,
            matchConfidence: match.confidence,
            description: match.description,
          },
        });
      }
      await emitProjectEvent({
        type: "project.updated",
        projectId,
        payload: { visionMatches: matches },
      });
      break;
    }
    case "RUN_TASK_AGENT": {
      const { taskId, remainingTaskIds, skipImageRequest } = data as {
        taskId: string;
        remainingTaskIds?: string[];
        skipImageRequest?: boolean;
      };
      try {
        const result = await runPostAgent(taskId, {
          skipImageRequest: Boolean(skipImageRequest),
        });
        if (result.paused) {
          const task = await prisma.task.findUnique({ where: { id: taskId } });
          const state = { ...((task?.agentState as Record<string, unknown>) ?? {}) };
          const photoPause = isPreImageRequestState(task?.agentState);
          if (photoPause) {
            state.preImageRequest = true;
          } else {
            delete state.preImageRequest;
          }
          state.remainingTaskIds = remainingTaskIds ?? [];
          await prisma.task.update({
            where: { id: taskId },
            data: { agentState: state as object },
          });
          if (!photoPause && task?.projectId) {
            await advanceImageCollectionQueue(task.projectId, { force: true });
          }
          break;
        }
        if (result.done) {
          const task = await prisma.task.findUnique({ where: { id: taskId } });
          if (task?.projectId) {
            await advanceImageCollectionQueue(task.projectId, { force: true });
          }
        }
        if (result.done && remainingTaskIds?.length) {
          const still = await filterNotStartedTaskIds(remainingTaskIds);
          if (still.length) await enqueueNextTask(still);
        }
      } catch (err) {
        if (isRetryable(err) || isTransientConnectionError(err)) throw err;
        await failTask(taskId, String(err));
        if (remainingTaskIds?.length) {
          const still = await filterNotStartedTaskIds(remainingTaskIds);
          if (still.length) await enqueueNextTask(still);
        }
      }
      break;
    }
    case "RESUME_TASK_AGENT": {
      const { taskId, userReply, resumeCheckpoint, fromImageRequest } = data as {
        taskId: string;
        userReply: string;
        remainingTaskIds?: string[];
        resumeCheckpoint?: boolean;
        fromImageRequest?: boolean;
      };
      const taskBefore = await prisma.task.findUnique({ where: { id: taskId } });
      const projectId = taskBefore?.projectId;
      const stored = (taskBefore?.agentState as { remainingTaskIds?: string[] }) ?? {};
      const remainingTaskIds = stored.remainingTaskIds ?? [];
      const wasPreImage =
        Boolean(fromImageRequest) || isPreImageRequestState(taskBefore?.agentState);

      try {
        const result = resumeCheckpoint
          ? await continuePostAgentFromSavedState(taskId)
          : wasPreImage
            ? await continuePostAgentAfterImageRequest(taskId, userReply)
            : await resumePostAgent(taskId, userReply);
        if (result.paused) {
          const taskNow = await prisma.task.findUnique({ where: { id: taskId } });
          const state = { ...((taskNow?.agentState as Record<string, unknown>) ?? {}) };
          if (isPreImageRequestState(taskNow?.agentState)) {
            state.preImageRequest = true;
          } else {
            delete state.preImageRequest;
          }
          state.remainingTaskIds = remainingTaskIds;
          await prisma.task.update({
            where: { id: taskId },
            data: { agentState: state as object },
          });
          if (projectId) {
            await advanceImageCollectionQueue(projectId, { force: true });
          }
          break;
        }
        if (result.done && remainingTaskIds.length && !wasPreImage) {
          const still = await filterNotStartedTaskIds(remainingTaskIds);
          if (still.length) await enqueueNextTask(still);
        }
        if (projectId) {
          await advanceImageCollectionQueue(projectId, { force: true });
        }
      } catch (err) {
        if (isRetryable(err) || isTransientConnectionError(err)) throw err;
        await failTask(taskId, String(err));
        if (projectId) {
          await advanceImageCollectionQueue(projectId, { force: true });
        }
      }
      break;
    }
    case "APPLY_FEEDBACK": {
      const payload = data as {
        taskId: string;
        generationId: string;
        feedback: string;
        target: "caption" | "image";
        referenceImageIds?: string[];
      };
      const { taskId, generationId, feedback, target, referenceImageIds } = payload;
      try {
        if (target === "caption") {
          await runCaptionWithFeedback(taskId, feedback);
          await updateTaskStatus(taskId, "NEEDS_APPROVAL" as TaskStatus, { statusLabel: null });
          await emitTaskDeliverableUpdated(taskId);
        } else {
          const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
          const feedbackReferenceUrls = await resolveFeedbackReferenceImages(
            task.projectId,
            referenceImageIds
          );
          const refined = await refineFeedback(taskId, generationId, feedback, {
            feedbackReferenceCount: feedbackReferenceUrls.length,
          });
          if (refined.changeType === "minor_edit") {
            await editImage({
              taskId,
              parentGenerationId: generationId,
              instruction: refined.instruction,
              feedback,
              changeType: refined.changeType,
              agentNote: refined.agentNoteDraft,
              feedbackReferenceUrls,
            });
          } else {
            await regenerateImage({
              taskId,
              parentGenerationId: generationId,
              prompt: refined.instruction,
              feedback,
              changeType: refined.changeType,
              agentNote: refined.agentNoteDraft,
              feedbackReferenceUrls,
            });
          }
          await updateTaskStatus(taskId, "NEEDS_APPROVAL" as TaskStatus, { statusLabel: null });
          await emitTaskDeliverableUpdated(taskId);
        }
      } catch (err) {
        if (isRetryable(err) || isTransientConnectionError(err)) throw err;
        await failTask(taskId, String(err));
      }
      break;
    }
    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}
