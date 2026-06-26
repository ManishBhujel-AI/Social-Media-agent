import { prisma } from "@/lib/db/prisma";
import { openRouterChatText } from "../openrouter";
import { MODELS } from "../models.config";
import { formatBrandKitForCaptionPrompt, resolveBrandKitForTask } from "@/lib/brandKit/formatForPrompt";

export async function runCaptionWithFeedback(
  taskId: string,
  feedback: string
): Promise<string> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const kit = await resolveBrandKitForTask(task);
  const brandContext = kit ? formatBrandKitForCaptionPrompt(kit) : "";

  const caption = await openRouterChatText({
    model: MODELS.caption.model,
    messages: [
      {
        role: "system",
        content:
          "Revise the caption per user feedback. Keep what works; apply the requested change precisely. Stay on-brand using the business summary and brand context provided. You may refine wording for clarity or impact when it strengthens the post.",
      },
      {
        role: "user",
        content: `Current caption:\n${task.caption}\n\nFeedback: ${feedback}\n\nSubject: ${task.subject}${brandContext ? `\n\nBrand context:\n${brandContext}` : ""}`,
      },
    ],
  });

  const trimmed = caption.trim();
  await prisma.$transaction([
    prisma.captionRevision.create({
      data: { taskId, caption: trimmed, feedback },
    }),
    prisma.task.update({ where: { id: taskId }, data: { caption: trimmed } }),
  ]);

  return trimmed;
}
