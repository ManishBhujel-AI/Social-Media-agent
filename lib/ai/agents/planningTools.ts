import { prisma } from "@/lib/db/prisma";
import type { ProductSummary } from "../productContext";
import { startPipelineForTasks } from "@/lib/queue/pipeline";
import type { PageFetchCache } from "@/lib/web/pageFetchCache";
import { ensureBrandKit } from "@/lib/brandKit/ensureBrandKit";
import { initBrandKit } from "@/lib/brandKit/initFromDescription";
import { startBrandKitGapFill } from "@/lib/brandKit/gapFill";
import { getForProject } from "@/lib/brandKit/store";
import { setProjectLogo } from "./projectLogo";
import { emitAgentActivity } from "@/lib/chat/agentActivity";
import { labelForAgentActivity } from "@/lib/chat/agentActivityLabels";
import { emitTaskCreated } from "@/lib/tasks/taskEvents";
import { saveContentReferenceFromTool } from "@/lib/content/ingestUserReference";
import type { ContentReferenceKind } from "@/lib/content/references";
import type { Task } from "@prisma/client";

export type PlanningContext = {
  projectId: string;
  conversationId: string;
  pageCache: PageFetchCache;
};

type CreatePostInput = {
  title: string;
  subject: string;
  productInfo?: object;
  businessInfo?: object;
  orderIndex: number;
};

function dedupePosts(posts: CreatePostInput[]): CreatePostInput[] {
  const seen = new Set<string>();
  const unique: CreatePostInput[] = [];
  for (const p of posts) {
    const title = (p.title || "").trim();
    const subject = (p.subject || title).trim();
    if (!title) continue;
    const key = `${title.toLowerCase()}|${subject.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ ...p, title, subject });
  }
  return unique;
}

async function maybeStartGapFill(ctx: PlanningContext, complete: boolean) {
  if (complete) return;
  await startBrandKitGapFill(ctx.projectId, ctx.conversationId);
}

export function createPlanningToolHandlers(ctx: PlanningContext) {
  return {
    ensureBrandKit: async (args: Record<string, unknown>) => {
      const url = args.url as string;
      const force = args.force === true;
      await emitAgentActivity(ctx.projectId, {
        label: labelForAgentActivity("ensureBrandKit", { url }),
        toolName: "ensureBrandKit",
      });
      const result = await ensureBrandKit(ctx.projectId, url, ctx.pageCache, { force });
      if (result.ok && !result.complete) {
        await maybeStartGapFill(ctx, result.complete);
      }
      return JSON.stringify(result);
    },

    initBrandKit: async (args: Record<string, unknown>) => {
      const description = typeof args.description === "string" ? args.description : undefined;
      await emitAgentActivity(ctx.projectId, {
        label: labelForAgentActivity("initBrandKit"),
        toolName: "initBrandKit",
      });
      const result = await initBrandKit(ctx.projectId, description);
      if (result.ok && !result.brandKit.complete) {
        await maybeStartGapFill(ctx, result.brandKit.complete);
      }
      return JSON.stringify(result);
    },

    /** @deprecated Use ensureBrandKit — kept for compatibility if the model calls it. */
    summarizeBusiness: async (args: Record<string, unknown>) => {
      const url = args.url as string;
      await emitAgentActivity(ctx.projectId, {
        label: labelForAgentActivity("ensureBrandKit", { url }),
        toolName: "ensureBrandKit",
      });
      const result = await ensureBrandKit(ctx.projectId, url, ctx.pageCache);
      if (result.ok && !result.complete) {
        await maybeStartGapFill(ctx, result.complete);
      }
      return JSON.stringify(result);
    },

    setProjectLogo: async (args: Record<string, unknown>) => {
      const imageId = args.imageId as string;
      const result = await setProjectLogo(ctx.projectId, imageId);
      const taskCount = await prisma.task.count({ where: { projectId: ctx.projectId } });
      return JSON.stringify({
        ...result,
        ...(taskCount === 0
          ? {
              requiredNextStep:
                "If the user already confirmed which posts to create, call createTasks in this same turn before replying about photo cards.",
            }
          : {}),
      });
    },

    saveContentReference: async (args: Record<string, unknown>) => {
      await emitAgentActivity(ctx.projectId, {
        label: labelForAgentActivity("saveContentReference"),
        toolName: "saveContentReference",
      });
      return saveContentReferenceFromTool(ctx.projectId, {
        kind: args.kind as ContentReferenceKind,
        scope: args.scope as "project" | "task",
        taskId: typeof args.taskId === "string" ? args.taskId : undefined,
        text: typeof args.text === "string" ? args.text : undefined,
        imageId: typeof args.imageId === "string" ? args.imageId : undefined,
        summary: typeof args.summary === "string" ? args.summary : "User reference",
        styleNotes: typeof args.styleNotes === "string" ? args.styleNotes : undefined,
      });
    },

    createTasks: async (args: Record<string, unknown>) => {
      const rawPosts = args.posts as CreatePostInput[];
      const posts = dedupePosts(Array.isArray(rawPosts) ? rawPosts : []);

      if (!posts.length) {
        return JSON.stringify({ status: "error", message: "No posts to create." });
      }

      const brandKit = await getForProject(ctx.projectId);
      if (!brandKit?.complete) {
        return JSON.stringify({
          status: "error",
          message:
            "Brand kit is incomplete. Answer the brand setup cards above or finish in Client Settings before creating posts.",
        });
      }

      await emitAgentActivity(ctx.projectId, {
        label: labelForAgentActivity("createTasks"),
        toolName: "createTasks",
      });

      try {
        const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });

        const businessSummary = (project.businessSummary as object) ?? {};
        const businessInfo = (project.businessInfo as object) ?? {};

        const resolvedPosts = posts.map((p) => ({
          ...p,
          productSummary: undefined as ProductSummary | undefined,
        }));

        const created: Task[] = [];
        for (let index = 0; index < resolvedPosts.length; index++) {
          const p = resolvedPosts[index];
          const productName = p.subject || p.title;
          const productInfo = (p.productInfo as { name?: string } | undefined)?.name
            ? p.productInfo
            : { name: productName };

          const task = await prisma.task.create({
            data: {
              projectId: ctx.projectId,
              title: p.title,
              subject: p.subject || productName,
              productInfo: productInfo as object,
              businessInfo: (p.businessInfo ?? businessInfo) as object,
              businessSummary: businessSummary as object,
              productSummary: (p.productSummary ?? undefined) as object | undefined,
              logoUrl: project.logoUrl ?? null,
              sourceImages: [] as object,
              orderIndex: index,
              status: "NOT_STARTED",
            },
          });
          created.push(task);
          await emitTaskCreated(task);
        }

        await startPipelineForTasks(created.map((t) => t.id));

        return JSON.stringify({
          status: "created",
          count: created.length,
          taskIds: created.map((t) => t.id),
          logoUrl: project.logoUrl,
        });
      } catch (err) {
        console.error("createTasks failed:", err);
        return JSON.stringify({
          status: "error",
          message: "Could not create tasks. Please try again.",
        });
      }
    },
  };
}

