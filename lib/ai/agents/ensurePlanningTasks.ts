import { prisma } from "@/lib/db/prisma";
import { MODELS } from "../models.config";
import { openRouterChatJSON } from "../openrouter";
import type { LoopMessage } from "../agentLoop";
import { createPlanningToolHandlers, type PlanningContext } from "./planningTools";

type CreatePostInput = {
  title: string;
  subject: string;
  productInfo?: { name: string };
  orderIndex: number;
};

export async function inferConfirmedPostsFromConversation(
  conversationId: string
): Promise<CreatePostInput[] | null> {
  const messages = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "asc" },
    take: 24,
    select: { role: true, content: true },
  });
  if (!messages.length) return null;

  try {
    const result = await openRouterChatJSON<{
      confirmed: boolean;
      posts: Array<{ title?: string; subject: string; orderIndex?: number }>;
    }>({
      model: MODELS.promptRefiner.model,
      messages: [
        {
          role: "system",
          content: `Extract confirmed social posts from a planning chat. Return JSON:
{ "confirmed": boolean, "posts": [{ "title": "Social Post for …", "subject": "product name", "orderIndex": 0 }] }
- confirmed is true only when the user specified what to post about AND how many (or clearly agreed to create).
- Include only posts the user confirmed — do not invent extras.
- title should be like "Social Post for Air Filters".`,
        },
        {
          role: "user",
          content: messages
            .map((m) => `${m.role}: ${m.content.slice(0, 2000)}`)
            .join("\n\n"),
        },
      ],
    });

    if (!result.confirmed || !result.posts?.length) return null;

    return result.posts.map((p, index) => {
      const subject = p.subject.trim();
      return {
        title: p.title?.trim() || `Social Post for ${subject}`,
        subject,
        productInfo: { name: subject },
        orderIndex: p.orderIndex ?? index,
      };
    });
  } catch (err) {
    console.warn("[ensurePlanningTasks] infer posts failed:", err);
    return null;
  }
}

/** Confirmed plan exists but createTasks was never called — recover so the photo card appears. */
export async function ensureConfirmedPlanningTasks(
  ctx: PlanningContext,
  loopMessages: LoopMessage[],
  lastUserMessage: string
): Promise<boolean> {
  const taskCount = await prisma.task.count({ where: { projectId: ctx.projectId } });
  if (taskCount > 0) return false;

  if (loopMessages.some((m) => m.role === "tool" && m.name === "createTasks")) {
    return false;
  }

  const project = await prisma.project.findUnique({
    where: { id: ctx.projectId },
    select: { logoUrl: true },
  });
  const logoReady =
    Boolean(project?.logoUrl?.trim()) ||
    loopMessages.some((m) => m.role === "tool" && m.name === "setProjectLogo");
  const declinedLogo = /\b(no logo|don't have a logo|skip logo|without a logo)\b/i.test(
    lastUserMessage
  );
  if (!logoReady && !declinedLogo) return false;

  const posts = await inferConfirmedPostsFromConversation(ctx.conversationId);
  if (!posts?.length) return false;

  const handlers = createPlanningToolHandlers(ctx);
  const raw = await handlers.createTasks({ posts });
  const parsed = JSON.parse(raw) as { status?: string };
  return parsed.status === "created";
}

/** @deprecated Use ensureConfirmedPlanningTasks */
export async function ensureTasksAfterLogoUpload(
  ctx: PlanningContext,
  loopMessages: LoopMessage[]
): Promise<boolean> {
  return ensureConfirmedPlanningTasks(ctx, loopMessages, "");
}
