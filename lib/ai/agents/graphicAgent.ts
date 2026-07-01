import { createId } from "@paralleldrive/cuid2";
import { list } from "@vercel/blob";
import { MODELS } from "../models.config";
import { getImageProvider } from "../imageProvider";
import { getStorage } from "@/lib/storage";
import { prisma } from "@/lib/db/prisma";
import { generateImagePrompt } from "./promptRefiner";
import { generatePostContentForTask } from "../postContent";
import { RetryableError } from "../errors";
import { buildGraphicReferences } from "../graphicReferences";
import { assembleImageModelPrompt } from "../imageModelPrompt";
import {
  loadGraphicCopyForTask,
  resolveBrandKitForTask,
} from "@/lib/brandKit/formatForPrompt";
import { withTransientRetry } from "@/lib/db/transientRetry";

const makingGraphicTaskIds = new Set<string>();

function generatedStorageKey(generationId: string): string {
  return `generated/${generationId}.png`;
}

async function findReusableGeneration(taskId: string) {
  return prisma.generation.findFirst({
    where: { taskId, imagePath: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { id: true, imagePath: true, generationId: true },
  });
}

async function findLatestGeneration(taskId: string) {
  return prisma.generation.findFirst({
    where: { taskId },
    orderBy: { createdAt: "desc" },
    select: { id: true, imagePath: true, generationId: true, prompt: true },
  });
}

async function resolveStoredImageUrl(generationId: string): Promise<string> {
  const key = generatedStorageKey(generationId);
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { blobs } = await list({ prefix: key });
    const match = blobs.find((b) => b.pathname === key);
    if (!match?.url) {
      throw new RetryableError(`Blob exists for ${key} but URL could not be resolved`);
    }
    return match.url;
  }
  return `/api/files/generated/${generationId}.png`;
}

async function linkTaskToGeneration(
  taskId: string,
  task: { threadId: string | null },
  gen: { id: string; generationId: string; imagePath: string }
): Promise<string> {
  await withTransientRetry(
    () =>
      prisma.task.update({
        where: { id: taskId },
        data: {
          currentGenerationId: gen.id,
          threadId: task.threadId ?? gen.generationId,
        },
      }),
    { label: "makeGraphic link task" }
  );
  return gen.imagePath;
}

export async function makeGraphicForTask(taskId: string): Promise<string> {
  const existingDone = await findReusableGeneration(taskId);
  if (existingDone?.imagePath) {
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
    return linkTaskToGeneration(taskId, task, {
      id: existingDone.id,
      generationId: existingDone.generationId,
      imagePath: existingDone.imagePath,
    });
  }

  if (makingGraphicTaskIds.has(taskId)) {
    const done = await findReusableGeneration(taskId);
    if (done?.imagePath) {
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      return linkTaskToGeneration(taskId, task, {
        id: done.id,
        generationId: done.generationId,
        imagePath: done.imagePath,
      });
    }
    throw new RetryableError("Graphic generation already in progress for this post");
  }

  makingGraphicTaskIds.add(taskId);
  try {
    return await makeGraphicForTaskInner(taskId);
  } finally {
    makingGraphicTaskIds.delete(taskId);
  }
}

async function makeGraphicForTaskInner(taskId: string): Promise<string> {
  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { project: true },
  });
  if (!task.caption) throw new Error("Task has no caption — run writeCaption first");

  const existing = await findReusableGeneration(taskId);
  if (existing?.imagePath) {
    return linkTaskToGeneration(taskId, task, {
      id: existing.id,
      generationId: existing.generationId,
      imagePath: existing.imagePath,
    });
  }

  const storage = getStorage();
  const latest = await findLatestGeneration(taskId);

  if (latest?.imagePath) {
    return linkTaskToGeneration(taskId, task, {
      id: latest.id,
      generationId: latest.generationId,
      imagePath: latest.imagePath,
    });
  }

  if (latest && !latest.imagePath) {
    const storageKey = generatedStorageKey(latest.generationId);
    if (await storage.exists(storageKey)) {
      const imagePath = await resolveStoredImageUrl(latest.generationId);
      await withTransientRetry(
        () =>
          prisma.generation.update({
            where: { id: latest.id },
            data: { imagePath },
          }),
        { label: "makeGraphic backfill generation" }
      );
      return linkTaskToGeneration(taskId, task, {
        id: latest.id,
        generationId: latest.generationId,
        imagePath,
      });
    }
  }

  let creativeBrief = task.imagePrompt;
  if (!creativeBrief) {
    if (!task.graphicCopy) {
      throw new Error("Task has no graphic copy — run writeCaption first");
    }
    creativeBrief = await generateImagePrompt(taskId);
  }

  const kit = await resolveBrandKitForTask(task);
  if (!kit) throw new Error("Brand kit required for graphic generation");

  const graphicCopy = await loadGraphicCopyForTask(taskId);
  if (!graphicCopy) {
    throw new Error("Task has no graphic copy — run writeCaption first");
  }

  const { referenceImageUrls, resolvedRefs } = await buildGraphicReferences(task);
  const prompt = assembleImageModelPrompt({
    creativeBrief,
    graphicCopy,
    kit,
    refs: resolvedRefs,
  });

  let genDbId: string;
  let generationId: string;

  if (latest) {
    genDbId = latest.id;
    generationId = latest.generationId;
    await prisma.generation.update({
      where: { id: genDbId },
      data: { prompt },
    });
  } else {
    generationId = createId();
    const gen = await prisma.generation.create({
      data: { taskId, generationId, prompt },
    });
    genDbId = gen.id;
  }

  try {
    const provider = getImageProvider();
    const buffer = await provider.generate({
      prompt,
      referenceImageUrl: referenceImageUrls[0],
      referenceImageUrls: referenceImageUrls.length > 1 ? referenceImageUrls : undefined,
    });

    const saved = await storage.saveGenerated(buffer, "image/png", `${generationId}.png`);
    await withTransientRetry(
      () =>
        prisma.generation.update({
          where: { id: genDbId },
          data: { imagePath: saved.url },
        }),
      { label: "makeGraphic save generation" }
    );

    return linkTaskToGeneration(taskId, task, {
      id: genDbId,
      generationId,
      imagePath: saved.url,
    });
  } catch (err) {
    throw err instanceof RetryableError ? err : new RetryableError(String(err));
  }
}

export async function writeCaptionForTask(taskId: string): Promise<string> {
  const { caption } = await generatePostContentForTask(taskId);
  return caption;
}
