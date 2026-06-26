import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/db/prisma";
import {
  isMonolithicCaptionExample,
  productNamesMatch,
  splitCaptionExamplesHeuristic,
  type CaptionExampleSegment,
} from "./splitCaptionExamples";

export type ContentReferenceKind =
  | "caption_example"
  | "copy_snippet"
  | "brand_voice"
  | "style_graphic"
  | "old_post_graphic";

export type ContentReference = {
  id: string;
  kind: ContentReferenceKind;
  scope: "project" | "task";
  taskId?: string;
  /** Product label for matching when taskId is unknown or scope is project. */
  productHint?: string;
  text?: string;
  imageId?: string;
  summary: string;
  styleNotes?: string;
  createdAt: string;
  sourceMessageId?: string;
};

const MAX_PROJECT_REFS = 20;
const MAX_TASK_REFS = 5;
const CAPTION_EXAMPLE_PROMPT_CHARS = 2800;
const COPY_SNIPPET_PROMPT_CHARS = 1500;

export function parseContentReferences(raw: unknown): ContentReference[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is ContentReference =>
      r != null &&
      typeof r === "object" &&
      typeof (r as ContentReference).id === "string" &&
      typeof (r as ContentReference).summary === "string"
  );
}

export async function getProjectReferences(projectId: string): Promise<ContentReference[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { contentReferences: true },
  });
  return parseContentReferences(project?.contentReferences);
}

type TaskRefMatch = { id: string; subject: string; title: string };

export function referenceMatchesTask(ref: ContentReference, task: TaskRefMatch): boolean {
  if (ref.scope === "task" && ref.taskId) return ref.taskId === task.id;
  if (ref.productHint) {
    return (
      productNamesMatch(ref.productHint, task.subject) ||
      productNamesMatch(ref.productHint, task.title)
    );
  }
  return ref.scope === "project";
}

function expandMonolithicCaptionRef(
  ref: ContentReference,
  task: TaskRefMatch,
  allTasks: TaskRefMatch[]
): ContentReference[] {
  if (ref.kind !== "caption_example" || !ref.text || ref.productHint) return [ref];
  if (!isMonolithicCaptionExample(ref.text)) return [ref];

  const segments = splitCaptionExamplesHeuristic(ref.text, allTasks);
  const forTask = segments.filter(
    (s) =>
      productNamesMatch(s.productName, task.subject) ||
      productNamesMatch(s.productName, task.title)
  );

  if (!forTask.length) return [];

  return forTask.map((segment) => segmentToReference(ref, segment));
}

function segmentToReference(
  base: ContentReference,
  segment: CaptionExampleSegment
): ContentReference {
  return {
    ...base,
    id: `${base.id}-${normalizeProductKey(segment.productName)}`,
    text: segment.caption,
    productHint: segment.productName,
    summary: segment.summary,
    scope: segment.taskId ? "task" : base.scope,
    taskId: segment.taskId ?? base.taskId,
  };
}

function normalizeProductKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
}

export function resolveReferencesForTask(
  refs: ContentReference[],
  task: TaskRefMatch,
  allTasks: TaskRefMatch[] = []
): ContentReference[] {
  const resolved: ContentReference[] = [];
  for (const ref of refs) {
    if (!referenceMatchesTask(ref, task)) continue;
    if (ref.kind === "caption_example" && isMonolithicCaptionExample(ref.text)) {
      resolved.push(...expandMonolithicCaptionRef(ref, task, allTasks));
    } else {
      resolved.push(ref);
    }
  }
  return resolved;
}

export async function getReferencesForTask(
  projectId: string,
  taskId: string
): Promise<ContentReference[]> {
  const [all, task, allTasks] = await Promise.all([
    getProjectReferences(projectId),
    prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, subject: true, title: true, projectId: true },
    }),
    prisma.task.findMany({
      where: { projectId },
      orderBy: { orderIndex: "asc" },
      select: { id: true, subject: true, title: true },
    }),
  ]);
  if (!task) return [];
  return resolveReferencesForTask(all, task, allTasks);
}

export async function addContentReference(
  projectId: string,
  ref: Omit<ContentReference, "id" | "createdAt"> & { id?: string; createdAt?: string }
): Promise<ContentReference> {
  const existing = await getProjectReferences(projectId);
  const entry: ContentReference = {
    id: ref.id ?? createId(),
    createdAt: ref.createdAt ?? new Date().toISOString(),
    kind: ref.kind,
    scope: ref.scope,
    taskId: ref.taskId,
    productHint: ref.productHint,
    text: ref.text,
    imageId: ref.imageId,
    summary: ref.summary,
    styleNotes: ref.styleNotes,
    sourceMessageId: ref.sourceMessageId,
  };

  const taskScoped = existing.filter((r) => r.taskId === ref.taskId).length;
  const projectScoped = existing.filter((r) => r.scope === "project").length;
  let next = [...existing, entry];
  if (ref.scope === "task" && ref.taskId && taskScoped >= MAX_TASK_REFS) {
    const oldest = next.findIndex((r) => r.taskId === ref.taskId);
    if (oldest >= 0) next.splice(oldest, 1);
  }
  if (ref.scope === "project" && projectScoped >= MAX_PROJECT_REFS) {
    const oldest = next.findIndex((r) => r.scope === "project");
    if (oldest >= 0) next.splice(oldest, 1);
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { contentReferences: next as object },
  });
  return entry;
}

export async function addContentReferences(
  projectId: string,
  refs: Array<Omit<ContentReference, "id" | "createdAt"> & { id?: string; createdAt?: string }>
): Promise<ContentReference[]> {
  const saved: ContentReference[] = [];
  for (const ref of refs) {
    saved.push(await addContentReference(projectId, ref));
  }
  return saved;
}

export function formatReferencesForCaptionPrompt(refs: ContentReference[]): string {
  if (!refs.length) return "";
  const lines: string[] = ["USER-PROVIDED REFERENCES:"];
  for (const r of refs) {
    if (r.kind === "style_graphic" || r.kind === "old_post_graphic") continue;
    if (r.kind === "caption_example") {
      const label = r.productHint ? ` (${r.productHint})` : "";
      lines.push(
        `- Client-approved caption example${label} — match voice, hooks, structure, factual claims, CTA style, and hashtag count/mix; light refresh for engagement is OK:\n  ${(r.text ?? "").slice(0, CAPTION_EXAMPLE_PROMPT_CHARS)}`
      );
    } else if (r.kind === "copy_snippet") {
      lines.push(
        `- Background info (facts only): ${r.summary}${r.text ? `\n  ${r.text.slice(0, COPY_SNIPPET_PROMPT_CHARS)}` : ""}`
      );
    } else if (r.kind === "brand_voice") {
      lines.push(
        `- Brand voice notes: ${r.summary}${r.text ? `\n  ${r.text.slice(0, 800)}` : ""}`
      );
    }
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export function formatReferencesForGraphicPrompt(refs: ContentReference[]): string {
  const styleRefs = refs.filter(
    (r) => r.kind === "style_graphic" || r.kind === "old_post_graphic"
  );
  if (!styleRefs.length) return "";
  const lines = [
    "STYLE INSPIRATION (create original composition — do not clone or reproduce third-party logos/text):",
  ];
  for (const r of styleRefs) {
    lines.push(`- ${r.summary}${r.styleNotes ? `: ${r.styleNotes}` : ""}`);
  }
  return lines.join("\n");
}

export function formatProjectReferencesSummary(refs: ContentReference[]): string {
  if (!refs.length) return "";
  return `Saved references (${refs.length}): ${refs.map((r) => `${r.kind}: ${r.summary}`).join("; ")}`;
}

export function collectCopySnippetContext(refs: ContentReference[]): string {
  return refs
    .filter((r) => r.kind === "copy_snippet" && r.text)
    .map((r) => r.text!)
    .join("\n\n");
}

/** Facts and positioning from pasted captions — used for marketing research enrichment. */
export function collectResearchContextFromReferences(refs: ContentReference[]): string {
  const parts: string[] = [];

  for (const r of refs) {
    if (!r.text?.trim()) continue;
    if (r.kind === "copy_snippet") {
      parts.push(r.text.trim());
    }
    if (r.kind === "caption_example") {
      const label = r.productHint ?? r.summary;
      parts.push(
        `Client-approved caption for ${label} (extract product facts, benefits, audience, and offers — do not invent beyond this):\n${r.text.trim()}`
      );
    }
  }

  return parts.join("\n\n");
}

export async function getStyleReferenceImageUrls(
  projectId: string,
  taskId: string
): Promise<string[]> {
  const refs = await getReferencesForTask(projectId, taskId);
  const imageIds = refs
    .filter((r) => r.kind === "style_graphic" || r.kind === "old_post_graphic")
    .map((r) => r.imageId)
    .filter((id): id is string => Boolean(id));
  if (!imageIds.length) return [];

  const images = await prisma.uploadedImage.findMany({
    where: { id: { in: imageIds }, projectId },
    select: { blobUrl: true },
  });
  return images.map((i) => i.blobUrl);
}
