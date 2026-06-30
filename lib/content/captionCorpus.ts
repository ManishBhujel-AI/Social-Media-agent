import { prisma } from "@/lib/db/prisma";
import { parseContentReferences } from "./references";

const CORPUS_SEPARATOR = "\n\n---\n\n";

const PAST_CONTENT_REFERENCE_INTRO =
  "This is the old content from the client for reference. Don't copy ditto — this is just for your reference on how content styles and info were in the past. Create new ones with your own creativity please. Use a similar caption length to these samples.";

/** Merge legacy per-caption references into one text block (read-time fallback). */
export function corpusFromLegacyReferences(raw: unknown): string {
  const refs = parseContentReferences(raw);
  const captions = refs
    .filter((r) => r.kind === "caption_example" && r.text?.trim())
    .map((r) => r.text!.trim());
  return captions.join(CORPUS_SEPARATOR);
}

export function splitCorpusBlocks(corpus: string): string[] {
  const trimmed = corpus.trim();
  if (!trimmed) return [];
  const bySeparator = trimmed.split(CORPUS_SEPARATOR).map((b) => b.trim()).filter(Boolean);
  if (bySeparator.length > 1) return bySeparator;
  return [trimmed];
}

export async function getCaptionCorpus(projectId: string): Promise<string> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { captionCorpus: true, contentReferences: true },
  });
  if (!project) return "";

  const stored = project.captionCorpus?.trim();
  if (stored) return stored;

  return corpusFromLegacyReferences(project.contentReferences);
}

export type SetCaptionCorpusResult = {
  corpus: string;
};

export async function setCaptionCorpus(
  projectId: string,
  corpus: string
): Promise<SetCaptionCorpusResult> {
  const trimmed = corpus.trim();

  if (!trimmed) {
    await prisma.project.update({
      where: { id: projectId },
      data: { captionCorpus: null },
    });
    return { corpus: "" };
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { captionCorpus: trimmed },
  });

  return { corpus: trimmed };
}

/** Append new caption text without duplicating an identical block. */
export async function appendToCaptionCorpus(
  projectId: string,
  block: string
): Promise<SetCaptionCorpusResult> {
  const next = block.trim();
  if (!next) {
    const corpus = await getCaptionCorpus(projectId);
    return { corpus };
  }

  const existing = await getCaptionCorpus(projectId);
  if (existing) {
    if (existing.includes(next)) {
      return { corpus: existing };
    }
    return setCaptionCorpus(projectId, `${existing}${CORPUS_SEPARATOR}${next}`);
  }
  return setCaptionCorpus(projectId, next);
}

export function extractProductRelevantFromCorpus(corpus: string, productName: string): string {
  if (!corpus.trim() || !productName.trim()) return "";

  const tokens = productName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (!tokens.length) return "";

  const blocks = splitCorpusBlocks(corpus);
  const matched = blocks.filter((block) => {
    const lower = block.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  });

  return matched.join(CORPUS_SEPARATOR).trim();
}

export function formatCaptionCorpusForPrompt(corpus: string): string {
  if (!corpus.trim()) return "";
  return [PAST_CONTENT_REFERENCE_INTRO, corpus.trim()].join("\n\n");
}

export function formatCaptionCorpusForGraphicPrompt(corpus: string): string {
  if (!corpus.trim()) return "";
  return [
    PAST_CONTENT_REFERENCE_INTRO,
    corpus.trim().slice(0, 6000),
  ].join("\n\n");
}

/** Derive hashtag guidance from past captions. */
export function hashtagGuidanceFromCorpus(corpus: string): string {
  if (!corpus.includes("#")) {
    return "Hashtags: end with 4–6 relevant tags — include branded, local/location, and service-category tags.";
  }

  const blocks = splitCorpusBlocks(corpus).filter((b) => b.includes("#"));
  const counts = blocks.map((text) => (text.match(/#[\w]+/g) ?? []).length).filter((n) => n > 0);
  if (!counts.length) {
    const inlineCount = (corpus.match(/#[\w]+/g) ?? []).length;
    if (inlineCount > 0) {
      const target = Math.min(8, Math.max(4, Math.round(inlineCount / Math.max(blocks.length, 1))));
      return `Hashtags: use about ${target} relevant tags at the end — match patterns in the client's past content.`;
    }
    return "Hashtags: end with 4–6 relevant tags — include branded, local/location, and service-category tags.";
  }

  const avg = Math.round(counts.reduce((a, b) => a + b, 0) / counts.length);
  const target = Math.min(8, Math.max(4, avg));
  return `Hashtags: use about ${target} relevant tags at the end — match patterns in the client's past content (branded, local, service-category).`;
}
