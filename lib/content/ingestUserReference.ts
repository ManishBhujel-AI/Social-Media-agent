import { createId } from "@paralleldrive/cuid2";
import { MODELS } from "@/lib/ai/models.config";
import { openRouterChatJSON } from "@/lib/ai/openrouter";
import { analyzeUploadedImageIntent } from "@/lib/ai/agents/visionAgent";
import { prisma } from "@/lib/db/prisma";
import { resolveSourceImages } from "@/lib/ai/resolveSourceImages";
import { setProjectLogo } from "@/lib/ai/agents/projectLogo";
import {
  addContentReference,
  addContentReferences,
  type ContentReferenceKind,
} from "./references";
import { splitCaptionExamples } from "./splitCaptionExamples";

export type IngestResult = {
  saved: boolean;
  /** Factual notes for the planning agent — not shown verbatim to the user. */
  agentNotes: string[];
  redirectToPhotoCard?: boolean;
};

type ClassifyTextResult = {
  kind: ContentReferenceKind;
  scope: "project" | "task";
  taskId?: string;
  summary: string;
  confidence: number;
};

const SHORT_REPLY_MAX = 80;

export async function ingestUserReference(params: {
  projectId: string;
  conversationId: string;
  messageId?: string;
  text?: string;
  imageIds?: string[];
}): Promise<IngestResult> {
  const trimmed = params.text?.trim() ?? "";
  const imageIds = params.imageIds ?? [];
  if (!trimmed && !imageIds.length) {
    return { saved: false, agentNotes: [] };
  }

  if (trimmed.length <= SHORT_REPLY_MAX && !imageIds.length) {
    const lower = trimmed.toLowerCase();
    if (
      ["generate", "yes", "no", "ok", "okay", "go ahead", "create", "stop", "resume"].includes(
        lower
      ) ||
      lower.startsWith("[uploaded")
    ) {
      return { saved: false, agentNotes: [] };
    }
  }

  const tasks = await prisma.task.findMany({
    where: {
      projectId: params.projectId,
      status: {
        notIn: ["APPROVED"],
      },
    },
    orderBy: { orderIndex: "asc" },
    select: { id: true, title: true, subject: true, orderIndex: true },
  });

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { logoUrl: true },
  });

  const agentNotes: string[] = [];
  let saved = false;
  let redirectToPhotoCard = false;

  for (const imageId of imageIds) {
    const urls = await resolveSourceImages(params.projectId, [imageId]);
    const url = urls[0];
    if (!url) continue;

    let analysis;
    try {
      analysis = await analyzeUploadedImageIntent(url, {
        hasProjectLogo: Boolean(project?.logoUrl),
      });
    } catch (err) {
      console.warn("[ingestUserReference] vision classify failed:", err);
      continue;
    }

    if (analysis.kind === "logo") {
      await setProjectLogo(params.projectId, imageId);
      agentNotes.push("Uploaded image verified as logo and saved on the project.");
      saved = true;
      continue;
    }

    if (analysis.kind === "product_photo") {
      redirectToPhotoCard = true;
      agentNotes.push(
        "Uploaded image looks like a product photo, not stored — user should use per-post photo cards."
      );
      continue;
    }

    const kind: ContentReferenceKind =
      analysis.kind === "old_post_graphic" ? "old_post_graphic" : "style_graphic";

    await prisma.uploadedImage.update({
      where: { id: imageId },
      data: {
        referenceKind: kind,
        referenceMeta: {
          styleNotes: analysis.styleNotes,
          onImageText: analysis.onImageText,
        } as object,
      },
    });

    await addContentReference(params.projectId, {
      kind,
      scope: "project",
      imageId,
      summary: `Style reference: ${analysis.styleNotes.slice(0, 120) || kind}`,
      styleNotes: analysis.styleNotes,
      sourceMessageId: params.messageId,
    });

    agentNotes.push(`Style graphic stored as ${kind} content reference for future posts.`);
    saved = true;
  }

  if (trimmed && trimmed.length > SHORT_REPLY_MAX) {
    const classified = await classifyPastedText(trimmed, tasks);
    if (classified.confidence >= 0.5) {
      if (classified.kind === "caption_example") {
        const segments = await splitCaptionExamples(trimmed, tasks);
        if (segments.length > 1) {
          await addContentReferences(
            params.projectId,
            segments.map((segment) => ({
              kind: "caption_example" as const,
              scope: segment.taskId ? ("task" as const) : ("project" as const),
              taskId: segment.taskId,
              productHint: segment.productName,
              text: segment.caption,
              summary: segment.summary,
              sourceMessageId: params.messageId,
            }))
          );
          agentNotes.push(
            `Stored ${segments.length} client-approved caption examples (${segments.map((s) => s.productName).join(", ")}).`
          );
          saved = true;
        } else {
          const segment = segments[0];
          await addContentReference(params.projectId, {
            kind: "caption_example",
            scope: segment?.taskId ? "task" : classified.scope,
            taskId: segment?.taskId ?? classified.taskId,
            productHint: segment?.productName,
            text: segment?.caption ?? trimmed,
            summary: segment?.summary ?? classified.summary,
            sourceMessageId: params.messageId,
          });
          const scopeLabel = segment?.productName ?? classified.summary;
          agentNotes.push(`User paste stored as caption example for ${scopeLabel}.`);
          saved = true;
        }
      } else {
        await addContentReference(params.projectId, {
          kind: classified.kind,
          scope: classified.scope,
          taskId: classified.taskId,
          text: trimmed,
          summary: classified.summary,
          sourceMessageId: params.messageId,
        });
        const scopeLabel =
          classified.scope === "task"
            ? tasks.find((t) => t.id === classified.taskId)?.title ?? "one post"
            : "all posts";
        agentNotes.push(
          `User paste stored as ${classified.kind.replace(/_/g, " ")} for ${scopeLabel}.`
        );
        saved = true;
      }
    }
  }

  return { saved, agentNotes, redirectToPhotoCard };
}

async function classifyPastedText(
  text: string,
  tasks: { id: string; title: string; subject: string; orderIndex: number }[]
): Promise<ClassifyTextResult> {
  try {
    return await openRouterChatJSON<ClassifyTextResult>({
      model: MODELS.promptRefiner.model,
      messages: [
        {
          role: "system",
          content: `Classify pasted user content for a social content tool. Return JSON:
{ "kind": "caption_example"|"copy_snippet"|"brand_voice", "scope": "project"|"task", "taskId"?: string, "summary": "one line", "confidence": 0-1 }
- caption_example: old post copy, example caption
- copy_snippet: product facts, offers, FAQs, service details
- brand_voice: tone/style instructions
Pick taskId only if clearly about one post from the list.`,
        },
        {
          role: "user",
          content: `Posts: ${JSON.stringify(tasks.map((t) => ({ id: t.id, title: t.title, subject: t.subject })))}\n\nPasted text:\n${text.slice(0, 2000)}`,
        },
      ],
    });
  } catch {
    return {
      kind: text.length > 200 ? "copy_snippet" : "brand_voice",
      scope: "project",
      summary: text.slice(0, 80),
      confidence: 0.6,
    };
  }
}

export async function saveContentReferenceFromTool(
  projectId: string,
  args: {
    kind: ContentReferenceKind;
    scope: "project" | "task";
    taskId?: string;
    text?: string;
    imageId?: string;
    summary: string;
    styleNotes?: string;
  }
): Promise<string> {
  await addContentReference(projectId, {
    id: createId(),
    kind: args.kind,
    scope: args.scope,
    taskId: args.taskId,
    text: args.text,
    imageId: args.imageId,
    summary: args.summary,
    styleNotes: args.styleNotes,
  });
  return JSON.stringify({ status: "saved", kind: args.kind, scope: args.scope });
}
