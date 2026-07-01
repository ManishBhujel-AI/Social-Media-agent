import { createId } from "@paralleldrive/cuid2";
import { getImageProvider } from "../imageProvider";
import { MODELS } from "../models.config";
import { getStorage } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import { RetryableError } from "../errors";
import { buildGraphicReferences } from "../graphicReferences";
import { assembleImageModelPrompt } from "../imageModelPrompt";
import { MAX_FEEDBACK_REFERENCE_IMAGES } from "../imageRefs.config";
import {
  loadGraphicCopyForTask,
  resolveBrandKitForTask,
} from "@/lib/brandKit/formatForPrompt";
import { generateGraphicCopy } from "./promptRefiner";

function capFeedbackRefs(urls?: string[]): string[] {
  return (urls ?? []).slice(0, MAX_FEEDBACK_REFERENCE_IMAGES);
}

export async function editImage(params: {
  taskId: string;
  parentGenerationId: string;
  instruction: string;
  feedback: string;
  changeType: string;
  agentNote: string;
  feedbackReferenceUrls?: string[];
}): Promise<string> {
  const parent = await prisma.generation.findFirstOrThrow({
    where: { generationId: params.parentGenerationId },
  });
  if (!parent.imagePath) throw new Error("Parent generation has no image");

  const generationId = createId();
  const gen = await prisma.generation.create({
    data: {
      taskId: params.taskId,
      generationId,
      prompt: params.instruction,
      parentId: parent.id,
      feedback: params.feedback,
      changeType: params.changeType,
      agentNote: params.agentNote,
    },
  });

  const storage = getStorage();
  const dataUrl = await storage.readAsDataUrl(parent.imagePath);
  const provider = getImageProvider();
  const buffer = await provider.edit({
    originalImageUrl: dataUrl,
    instruction: params.instruction,
    referenceImageUrls: capFeedbackRefs(params.feedbackReferenceUrls),
    model: MODELS.imageFeedback.model,
  });

  const saved = await storage.saveGenerated(buffer, "image/png", `${generationId}.png`);
  await prisma.generation.update({
    where: { id: gen.id },
    data: { imagePath: saved.url },
  });
  await prisma.task.update({
    where: { id: params.taskId },
    data: { currentGenerationId: gen.id },
  });

  return saved.url;
}

export async function regenerateImage(params: {
  taskId: string;
  parentGenerationId: string;
  prompt: string;
  feedback: string;
  changeType: string;
  agentNote: string;
  feedbackReferenceUrls?: string[];
}): Promise<string> {
  const parent = await prisma.generation.findFirstOrThrow({
    where: { generationId: params.parentGenerationId },
  });

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: params.taskId },
    include: { project: true },
  });

  const baseBrief = task.imagePrompt?.trim();
  if (!baseBrief) {
    throw new Error("Task has no image prompt — run writeCaption first");
  }

  const kit = await resolveBrandKitForTask(task);
  if (!kit) throw new Error("Brand kit required for graphic generation");

  let graphicCopy = await loadGraphicCopyForTask(params.taskId);
  if (!graphicCopy) {
    await generateGraphicCopy(params.taskId);
    graphicCopy = await loadGraphicCopyForTask(params.taskId);
  }
  if (!graphicCopy) {
    throw new Error("Task has no graphic copy — run writeCaption first");
  }

  const { referenceImageUrls, resolvedRefs } = await buildGraphicReferences(task);
  const feedbackRefs = capFeedbackRefs(params.feedbackReferenceUrls);
  const allRefs = [...feedbackRefs, ...referenceImageUrls];

  let prompt = assembleImageModelPrompt({
    creativeBrief: baseBrief,
    graphicCopy,
    kit,
    refs: resolvedRefs,
  });
  prompt += `\n\nUSER REQUESTED CHANGES:\n${params.prompt}`;
  if (feedbackRefs.length) {
    prompt +=
      feedbackRefs.length > 1
        ? `\nUSER-ATTACHED REFERENCES: The user uploaded ${feedbackRefs.length} reference images — incorporate each as described in the feedback.`
        : "\nUSER-ATTACHED REFERENCE: The user uploaded a reference image to guide this revision — incorporate it as described in the feedback.";
  }

  const generationId = createId();
  const gen = await prisma.generation.create({
    data: {
      taskId: params.taskId,
      generationId,
      prompt,
      parentId: parent.id,
      feedback: params.feedback,
      changeType: params.changeType,
      agentNote: params.agentNote,
    },
  });

  const provider = getImageProvider();
  const buffer = await provider.generate({
    prompt,
    referenceImageUrl: allRefs[0],
    referenceImageUrls: allRefs.length > 1 ? allRefs : undefined,
    model: MODELS.imageFeedback.model,
  });
  const storage = getStorage();
  const saved = await storage.saveGenerated(buffer, "image/png", `${generationId}.png`);

  await prisma.generation.update({
    where: { id: gen.id },
    data: { imagePath: saved.url },
  });
  await prisma.task.update({
    where: { id: params.taskId },
    data: { currentGenerationId: gen.id },
  });

  return saved.url;
}
