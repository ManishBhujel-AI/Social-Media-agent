import { MODELS } from "@/lib/ai/models.config";
import { openRouterChatJSON } from "@/lib/ai/openrouter";

export type CaptionExampleSegment = {
  productName: string;
  caption: string;
  summary: string;
  taskId?: string;
};

type TaskHint = { id: string; title: string; subject: string };

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function productNamesMatch(hint: string, taskName: string): boolean {
  const a = normalizeName(hint);
  const b = normalizeName(taskName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const aTokens = new Set(a.split(" ").filter((t) => t.length > 2));
  const bTokens = new Set(b.split(" ").filter((t) => t.length > 2));
  let overlap = 0;
  Array.from(aTokens).forEach((t) => {
    if (bTokens.has(t)) overlap += 1;
  });
  const denom = Math.min(aTokens.size, bTokens.size);
  return denom > 0 && overlap / denom >= 0.5;
}

function inferProductFromCaption(caption: string, tasks: TaskHint[]): string | null {
  const lower = caption.toLowerCase();
  for (const task of tasks) {
    const names = [task.subject, task.title.replace(/^social post for\s+/i, "")];
    for (const name of names) {
      const n = normalizeName(name);
      if (n.length > 2 && lower.includes(n)) return task.subject;
    }
  }
  if (/\bmerv\b|air filter|pleated filter/i.test(caption)) return "Air Filters";
  if (/speedclean/i.test(caption)) return "SpeedClean Tools";
  if (/hi nitrogen|nitrogen network|nitrogen purge|tank fill/i.test(caption)) return "HI Nitrogen";
  return null;
}

/** Fast split for legacy monolithic caption_example blobs (quoted caption blocks). */
export function splitCaptionExamplesHeuristic(
  text: string,
  tasks: TaskHint[] = []
): CaptionExampleSegment[] {
  const normalized = text.replace(/""/g, '"');
  const blocks: string[] = [];
  const quoted = normalized.match(/"([^"]{80,})"/g);
  if (quoted?.length) {
    for (const q of quoted) {
      blocks.push(q.replace(/^"|"$/g, "").trim());
    }
  }
  if (!blocks.length) {
    const trimmed = text.trim();
    if (trimmed.length >= 80) blocks.push(trimmed);
  }

  const segments: CaptionExampleSegment[] = [];
  for (const caption of blocks) {
    const productName =
      inferProductFromCaption(caption, tasks) ??
      tasks[segments.length]?.subject ??
      `Product ${segments.length + 1}`;
    const task = tasks.find(
      (t) => productNamesMatch(productName, t.subject) || productNamesMatch(productName, t.title)
    );
    segments.push({
      productName,
      caption,
      summary: `Client-approved caption example for ${productName}`,
      taskId: task?.id,
    });
  }
  return segments;
}

export async function splitCaptionExamples(
  text: string,
  tasks: TaskHint[] = []
): Promise<CaptionExampleSegment[]> {
  const heuristic = splitCaptionExamplesHeuristic(text, tasks);
  if (heuristic.length >= 2) return heuristic;

  try {
    const result = await openRouterChatJSON<{
      examples: Array<{ productName: string; caption: string; summary?: string }>;
    }>({
      model: MODELS.promptRefiner.model,
      messages: [
        {
          role: "system",
          content: `Split pasted social media content into separate caption examples. Return JSON:
{ "examples": [{ "productName": "short product label", "caption": "full caption text", "summary": "one line" }] }
- One entry per distinct product/post.
- Keep each caption complete (hashtags, links, emojis).
- productName should match the user's product list when possible.
- If only one caption, return one entry.`,
        },
        {
          role: "user",
          content: `Known posts: ${JSON.stringify(tasks.map((t) => ({ id: t.id, subject: t.subject, title: t.title })))}\n\nPasted text:\n${text.slice(0, 12000)}`,
        },
      ],
    });

    const examples = result.examples?.filter((e) => e.caption?.trim().length >= 40) ?? [];
    if (!examples.length) return heuristic;

    return examples.map((e) => {
      const task = tasks.find(
        (t) =>
          productNamesMatch(e.productName, t.subject) || productNamesMatch(e.productName, t.title)
      );
      return {
        productName: e.productName.trim(),
        caption: e.caption.trim(),
        summary: e.summary?.trim() || `Client-approved caption example for ${e.productName.trim()}`,
        taskId: task?.id,
      };
    });
  } catch {
    return heuristic;
  }
}

export function isMonolithicCaptionExample(text: string | undefined): boolean {
  if (!text) return false;
  const normalized = text.replace(/""/g, '"');
  const quotedCount = (normalized.match(/"[^"]{80,}"/g) ?? []).length;
  if (quotedCount >= 2) return true;
  if (text.length < 500) return false;
  return /old captions|approved by the client/i.test(text);
}
