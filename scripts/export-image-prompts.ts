import fs from "fs/promises";
import path from "path";
import { prisma } from "../lib/db/prisma";

async function main() {
  const anchor = await prisma.task.findFirst({
    where: { title: { contains: "Unmatched Sporlan", mode: "insensitive" } },
    select: { projectId: true, project: { select: { name: true } } },
  });

  if (!anchor) {
    console.error("Project not found (no 'Unmatched Sporlan' task).");
    process.exit(1);
  }

  const tasks = await prisma.task.findMany({
    where: { projectId: anchor.projectId },
    orderBy: { orderIndex: "asc" },
    select: {
      orderIndex: true,
      title: true,
      imagePrompt: true,
      generations: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: { prompt: true, createdAt: true, generationId: true },
      },
    },
  });

  const posts = tasks.map((t) => {
    const gen = t.generations[0];
    const scaffoldIdx = t.imagePrompt?.indexOf("BRAND SCAFFOLD") ?? -1;
    const sonnetCreative =
      scaffoldIdx > 0 ? t.imagePrompt!.slice(0, scaffoldIdx).trim() : t.imagePrompt;

    const suffixIdx = gen?.prompt?.indexOf("Reference images:") ?? -1;
    let refSuffix: string | null = null;
    if (suffixIdx >= 0) {
      refSuffix = gen!.prompt.slice(suffixIdx);
    } else if (gen?.prompt?.includes("No brand logo available")) {
      refSuffix = gen.prompt.slice(gen.prompt.indexOf("No brand logo available"));
    } else if (gen?.prompt?.includes("No reference images available")) {
      refSuffix = gen.prompt.slice(gen.prompt.indexOf("No reference images available"));
    }

    return {
      post: t.orderIndex + 1,
      orderIndex: t.orderIndex,
      title: t.title,
      generationId: gen?.generationId ?? null,
      generatedAt: gen?.createdAt?.toISOString() ?? null,
      sonnetCreativeScene: sonnetCreative || null,
      fullTextPromptBeforeRefs: t.imagePrompt || null,
      referenceSuffixAddedAtGraphicGen: refSuffix,
      exactPromptSentToImageModel: gen?.prompt || null,
    };
  });

  const out = {
    project: anchor.project.name,
    exportedAt: new Date().toISOString(),
    modelNote: {
      sonnetModel: "openai/gpt-5.5 (MODELS.caption)",
      imageModel: "openai/gpt-image-2 (MODELS.image)",
      sonnetCreativeScene:
        "The creative scene — 2–4 sentences Sonnet returns as imagePrompt in the post-content JSON.",
      fullTextPromptBeforeRefs:
        "Sonnet creative scene + code-appended brand scaffold + extras. Saved on Task.imagePrompt before graphic generation.",
      referenceSuffixAddedAtGraphicGen:
        "Reference-image labels and logo/product rules appended at makeGraphic time.",
      exactPromptSentToImageModel:
        "The complete text prompt sent to the image model (Task.imagePrompt + reference suffix). Reference images are also attached separately as base64.",
    },
    posts,
  };

  const outDir = path.join(process.cwd(), "generated");
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "cosco-image-prompts.json");
  const mdPath = path.join(outDir, "cosco-image-prompts.md");

  await fs.writeFile(jsonPath, JSON.stringify(out, null, 2));

  const mdLines = [
    `# Image prompts — ${anchor.project.name}`,
    "",
    `Exported: ${out.exportedAt}`,
    "",
    "## How prompts are built",
    "",
    "1. **GPT-5.5** (`writeCaption`) returns a creative `imagePrompt` (scene/layout only).",
    "2. **App code** appends brand scaffold (colors, copy, contact, rules) → saved as `Task.imagePrompt`.",
    "3. **At `makeGraphic`**, reference-image suffix is appended → saved as `Generation.prompt`.",
    "4. **GPT Image 2** receives `Generation.prompt` text + product/logo photos as image attachments.",
    "",
    "---",
    "",
  ];

  for (const p of posts) {
    mdLines.push(`## Post ${p.post}: ${p.title}`);
    mdLines.push("");
    if (p.generatedAt) mdLines.push(`Generated: ${p.generatedAt}`);
    if (p.generationId) mdLines.push(`Generation ID: \`${p.generationId}\``);
    mdLines.push("");
    mdLines.push("### Sonnet creative scene");
    mdLines.push("");
    mdLines.push(p.sonnetCreativeScene ?? "_none_");
    mdLines.push("");
    mdLines.push("### Full text prompt (before reference suffix)");
    mdLines.push("");
    mdLines.push("```");
    mdLines.push(p.fullTextPromptBeforeRefs ?? "_none_");
    mdLines.push("```");
    mdLines.push("");
    mdLines.push("### Reference suffix (added at graphic gen)");
    mdLines.push("");
    mdLines.push(p.referenceSuffixAddedAtGraphicGen ?? "_none_");
    mdLines.push("");
    mdLines.push("### Exact prompt sent to image model");
    mdLines.push("");
    mdLines.push("```");
    mdLines.push(p.exactPromptSentToImageModel ?? "_none_");
    mdLines.push("```");
    mdLines.push("");
    mdLines.push("---");
    mdLines.push("");
  }

  await fs.writeFile(mdPath, mdLines.join("\n"));

  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
  console.log(`Posts exported: ${posts.length}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
