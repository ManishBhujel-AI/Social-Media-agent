import fs from "fs/promises";
import path from "path";
import { prisma } from "../lib/db/prisma";
import { buildPostContentPromptsForTask } from "../lib/ai/postContent";
import { MODELS } from "../lib/ai/models.config";

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
        model: MODELS.caption.model,
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
        note: "Sonnet prompts for writeCaption. imagePrompt is the creative brief only; makeGraphic appends ON GRAPHIC COPY and BRAND RULES.",
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
    "Sonnet returns JSON; imagePrompt is sent verbatim to the image model with product/logo files attached.",
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
