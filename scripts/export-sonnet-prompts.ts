import fs from "fs/promises";
import path from "path";
import { prisma } from "../lib/db/prisma";
import {
  formatProductInfoForPrompt,
  formatUserProductNotesForPrompt,
  formatVisualContextForPrompt,
  requireMarketingCopyContext,
} from "../lib/ai/productContext";
import { formatBrandKitForPostContentPrompt, resolveBrandKitForTask } from "../lib/brandKit/formatForPrompt";
import { resolvePreferenceContextFromTask } from "../lib/brandKit/preferences";
import {
  CAPTION_UNIVERSAL_RULES,
  GRAPHIC_COPY_SYSTEM_RULES,
} from "../lib/ai/generationRules";
import {
  formatCaptionCorpusForPrompt,
  getCaptionCorpus,
  hashtagGuidanceFromCorpus,
} from "../lib/content/captionCorpus";
import { formatReferencesForGraphicPrompt, getReferencesForTask } from "../lib/content/references";
import { MODELS } from "../lib/ai/models.config";
import type { Task } from "@prisma/client";

const POST_TOPIC_RULES = `POST TOPIC RULES (highest priority):
- Write about the product/service named in POST TOPIC only.
- Do not write about other products the client carries, even if they appear in CLIENT BACKGROUND or past captions.
- Graphic headline, subheadline, bullet, and caption must all be about the POST TOPIC product.`;

const POST_CONTENT_SYSTEM_PROMPT = `You write a complete social post package in one pass for ONE post only.

OUTPUT FORMAT (critical):
- Reply with a single raw JSON object — no markdown, no code fences, no preamble, no arrays of posts.
- Exactly these top-level keys: { "caption", "graphicCopy": { "headline", "subheadline", "bullet"?, "cta" }, "imagePrompt" }

${POST_TOPIC_RULES}

CAPTION:
${CAPTION_UNIVERSAL_RULES}
Open with a hook, lead with customer benefit, include a light CTA, end with hashtags.
Do NOT describe the product image — the graphic handles visuals.
Do NOT invent specs not in the product info or client detail.

GRAPHIC COPY (on-image text):
${GRAPHIC_COPY_SYSTEM_RULES}
Keep on-graphic text light — push detail into the caption. Headline and subheadline must align with the caption and the POST TOPIC product.

IMAGE PROMPT (creative scene only — 2-4 sentences):
Describe background, mood, layout, and product arrangement for THIS specific post so the design feels fresh, not templated.
Do NOT include hex color codes, contact phone numbers, brand rules, or the exact on-graphic copy text — the app appends those deterministically.
Focus on: setting, atmosphere, how product photos are composed, decorative elements, local/seasonal cues when relevant.`;

export async function buildPostContentPromptsForTask(task: Task) {
  const product = requireMarketingCopyContext(task);
  const kit = await resolveBrandKitForTask(task);
  if (!kit) throw new Error("Brand kit required");

  const prefContext = resolvePreferenceContextFromTask(task);
  const corpus = await getCaptionCorpus(task.projectId);
  const pastContentBlock = formatCaptionCorpusForPrompt(corpus);
  const refs = await getReferencesForTask(task.projectId, task.id);
  const styleImageBlock = formatReferencesForGraphicPrompt(refs);
  const notesBlock = formatUserProductNotesForPrompt(task.userProductNotes);
  const visualNote = formatVisualContextForPrompt(product.summary?.visualContext);
  const brandContext = formatBrandKitForPostContentPrompt(kit, prefContext);
  const uploadedPhotoCount = ((task.sourceImages as string[] | null) ?? []).length;
  const uploadedPhotoHint =
    uploadedPhotoCount > 0
      ? uploadedPhotoCount > 1
        ? `USER UPLOADED ${uploadedPhotoCount} PRODUCT PHOTOS for this post. Caption, graphicCopy, and imagePrompt must match what is shown in those photos. imagePrompt must compose the layout around the provided photos — do not invent a different product appearance.`
        : "USER UPLOADED A PRODUCT PHOTO for this post. Caption, graphicCopy, and imagePrompt must match what is shown in that photo. imagePrompt must compose the layout around the provided photo — do not invent a different product appearance."
      : null;

  const systemPrompt = `${POST_CONTENT_SYSTEM_PROMPT}\n\n${hashtagGuidanceFromCorpus(corpus)}`;
  const userContent = [
    formatProductInfoForPrompt({ name: product.name, summary: product.summary }),
    visualNote || null,
    brandContext ? `CLIENT BACKGROUND (who they are — NOT the post topic):\n${brandContext}` : null,
    notesBlock ? `USER-PROVIDED DETAIL FOR THIS POST:\n${notesBlock}` : null,
    uploadedPhotoHint,
    pastContentBlock || null,
    styleImageBlock || null,
    `POST TOPIC (write about this product only): ${product.name}`,
    "Write caption, graphicCopy, and imagePrompt together so they complement each other.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userContent, model: MODELS.caption.model };
}

async function main() {
  const anchor = await prisma.task.findFirst({
    where: { title: { contains: "Unmatched Sporlan", mode: "insensitive" } },
    select: { projectId: true, project: { select: { name: true } } },
  });
  if (!anchor) {
    console.error("No anchor task found");
    process.exit(1);
  }

  const tasks = await prisma.task.findMany({
    where: { projectId: anchor.projectId },
    orderBy: { orderIndex: "asc" },
  });

  const posts = [];
  for (const task of tasks) {
    try {
      const prompts = await buildPostContentPromptsForTask(task);
      posts.push({
        post: task.orderIndex + 1,
        title: task.title,
        model: prompts.model,
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userContent,
      });
    } catch (err) {
      posts.push({
        post: task.orderIndex + 1,
        title: task.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const outDir = path.join(process.cwd(), "generated");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "cosco-sonnet-prompts.json");
  const mdPath = path.join(outDir, "cosco-sonnet-prompts.md");

  await fs.writeFile(
    jsonPath,
    JSON.stringify(
      {
        project: anchor.project.name,
        model: MODELS.caption.model,
        exportedAt: new Date().toISOString(),
        note: "Exact prompts sent to Claude Sonnet 4.6 in writeCaption / generatePostContentForTask. No images attached — text only.",
        posts,
      },
      null,
      2
    )
  );

  const md: string[] = [
    `# Sonnet 4.6 prompts — ${anchor.project.name}`,
    "",
    `Model: \`${MODELS.caption.model}\``,
    "",
    "These are the **system** and **user** messages sent when writing caption + graphic copy + creative image scene.",
    "Sonnet returns JSON; the app then appends brand scaffold to the image scene before calling Gemini.",
    "",
    "---",
    "",
  ];

  for (const p of posts) {
    md.push(`## Post ${p.post}: ${p.title}`);
    md.push("");
    if ("error" in p && p.error) {
      md.push(`_Could not build prompts: ${p.error}_`);
      md.push("");
      md.push("---");
      md.push("");
      continue;
    }
    md.push("### System prompt");
    md.push("");
    md.push("```");
    md.push((p as { systemPrompt: string }).systemPrompt);
    md.push("```");
    md.push("");
    md.push("### User prompt");
    md.push("");
    md.push("```");
    md.push((p as { userPrompt: string }).userPrompt);
    md.push("```");
    md.push("");
    md.push("---");
    md.push("");
  }

  await fs.writeFile(mdPath, md.join("\n"));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Posts: ${posts.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
