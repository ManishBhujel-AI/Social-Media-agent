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
import type { Task, TaskStatus } from "@prisma/client";
import {
  buildPreferenceAppendPatch,
  buildProductNotePatch,
  parsePreferenceScope,
  parseProposalPatches,
  postSettingsProposal,
} from "@/lib/brandKit/settingsProposals";

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

/** Tasks that still represent an in-flight or recoverable post — block duplicate createTasks. */
const ACTIVE_TASK_STATUSES: TaskStatus[] = [
  "NOT_STARTED",
  "NEEDS_INFO",
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE",
  "NEEDS_APPROVAL",
  "FAILED",
];

function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

async function findActiveTasksBySubject(
  projectId: string,
  conversationId: string
): Promise<Map<string, Task>> {
  const tasks = await prisma.task.findMany({
    where: { projectId, conversationId, status: { in: ACTIVE_TASK_STATUSES } },
    orderBy: { createdAt: "asc" },
  });
  const bySubject = new Map<string, Task>();
  for (const t of tasks) {
    const key = normalizeSubject(t.subject);
    if (!bySubject.has(key)) bySubject.set(key, t);
  }
  return bySubject;
}

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

    proposeSettingsChange: async (args: Record<string, unknown>) => {
      const summary = typeof args.summary === "string" ? args.summary : "";
      const patches = parseProposalPatches(args.patches);
      if (!patches) {
        return JSON.stringify({ status: "error", message: "Invalid patches array." });
      }

      await emitAgentActivity(ctx.projectId, {
        label: "Proposing settings change…",
        toolName: "proposeSettingsChange",
      });

      const result = await postSettingsProposal({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        summary,
        patches,
        source: "agent",
      });

      if (!result.ok) {
        return JSON.stringify({ status: "error", message: result.error });
      }

      return JSON.stringify({
        status: "proposed",
        messageId: result.messageId,
        message:
          "Confirm card shown to the user. Do not repeat the save question in plain text — wait for them to confirm or dismiss.",
      });
    },

    proposePreferenceEntry: async (args: Record<string, unknown>) => {
      const scope = parsePreferenceScope(args.scope);
      const note = typeof args.note === "string" ? args.note : "";
      const summary =
        typeof args.summary === "string" && args.summary.trim()
          ? args.summary.trim()
          : `Save preference: ${note.slice(0, 120)}`;

      if (!scope) {
        return JSON.stringify({
          status: "error",
          message: "scope must be client, product:NAME, or topic:NAME",
        });
      }

      const patches = await buildPreferenceAppendPatch(ctx.projectId, { scope, note });
      if ("error" in patches) {
        return JSON.stringify({ status: "error", message: patches.error });
      }

      await emitAgentActivity(ctx.projectId, {
        label: "Proposing preference…",
        toolName: "proposePreferenceEntry",
      });

      const result = await postSettingsProposal({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        summary,
        patches,
        source: "agent",
      });

      if (!result.ok) {
        return JSON.stringify({ status: "error", message: result.error });
      }

      return JSON.stringify({
        status: "proposed",
        messageId: result.messageId,
        message:
          "Confirm card shown to the user. Do not repeat the save question in plain text — wait for them to confirm or dismiss.",
      });
    },

    proposeProductNote: async (args: Record<string, unknown>) => {
      const product = typeof args.product === "string" ? args.product : "";
      const note = typeof args.note === "string" ? args.note : "";
      const summary =
        typeof args.summary === "string" && args.summary.trim()
          ? args.summary.trim()
          : `Save product note for ${product}`;

      const patches = await buildProductNotePatch(ctx.projectId, product, note);
      if ("error" in patches) {
        return JSON.stringify({ status: "error", message: patches.error });
      }

      await emitAgentActivity(ctx.projectId, {
        label: "Proposing product note…",
        toolName: "proposeProductNote",
      });

      const result = await postSettingsProposal({
        projectId: ctx.projectId,
        conversationId: ctx.conversationId,
        summary,
        patches,
        source: "agent",
      });

      if (!result.ok) {
        return JSON.stringify({ status: "error", message: result.error });
      }

      return JSON.stringify({
        status: "proposed",
        messageId: result.messageId,
        message:
          "Confirm card shown to the user. Do not repeat the save question in plain text — wait for them to confirm or dismiss.",
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

        const existingBySubject = await findActiveTasksBySubject(ctx.projectId, ctx.conversationId);
        const alreadyMatched: Task[] = [];
        const toCreate: CreatePostInput[] = [];

        for (const p of posts) {
          const key = normalizeSubject(p.subject || p.title);
          const existing = existingBySubject.get(key);
          if (existing) {
            alreadyMatched.push(existing);
          } else {
            toCreate.push(p);
          }
        }

        if (!toCreate.length && alreadyMatched.length > 0) {
          const sorted = [...alreadyMatched].sort((a, b) => a.orderIndex - b.orderIndex);
          return JSON.stringify({
            status: "already_created",
            count: sorted.length,
            taskIds: sorted.map((t) => t.id),
            logoUrl: project.logoUrl,
            message:
              "Posts already exist for this batch. Photo cards are already in chat — do not call createTasks again. Reply with one short sentence only; do not repeat photo-card instructions.",
          });
        }

        const maxOrder = await prisma.task.aggregate({
          where: { projectId: ctx.projectId },
          _max: { orderIndex: true },
        });
        let nextOrderIndex = (maxOrder._max.orderIndex ?? -1) + 1;

        const resolvedPosts = toCreate.map((p) => ({
          ...p,
          productSummary: undefined as ProductSummary | undefined,
        }));

        const created: Task[] = [];
        for (const p of resolvedPosts) {
          const productName = p.subject || p.title;
          const productInfo = (p.productInfo as { name?: string } | undefined)?.name
            ? p.productInfo
            : { name: productName };

          const task = await prisma.task.create({
            data: {
              projectId: ctx.projectId,
              conversationId: ctx.conversationId,
              title: p.title,
              subject: p.subject || productName,
              productInfo: productInfo as object,
              businessInfo: (p.businessInfo ?? businessInfo) as object,
              businessSummary: businessSummary as object,
              productSummary: (p.productSummary ?? undefined) as object | undefined,
              logoUrl: project.logoUrl ?? null,
              sourceImages: [] as object,
              orderIndex: nextOrderIndex++,
              status: "NOT_STARTED",
            },
          });
          created.push(task);
          await emitTaskCreated(task);
        }

        if (created.length > 0) {
          await startPipelineForTasks(created.map((t) => t.id));
        }

        const allTaskIds = [
          ...alreadyMatched.map((t) => t.id),
          ...created.map((t) => t.id),
        ];

        return JSON.stringify({
          status: created.length === posts.length ? "created" : "partially_created",
          count: allTaskIds.length,
          taskIds: allTaskIds,
          createdCount: created.length,
          logoUrl: project.logoUrl,
          ...(created.length < posts.length
            ? {
                message:
                  "Some posts already existed — only missing posts were created. Do not call createTasks again for the same products.",
              }
            : {}),
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

