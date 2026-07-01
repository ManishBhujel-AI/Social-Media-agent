import { MODELS } from "../models.config";
import {
  runAgentLoop,
  serializeAgentState,
  deserializeAgentState,
  appendResumeToolResult,
  type LoopMessage,
} from "../agentLoop";
import type { ToolDef } from "../openrouter";
import { prisma } from "@/lib/db/prisma";
import {
  applyPendingContextImageNotes,
  findProduct,
  serializeFindProductResultForAgent,
} from "./productAgent";
import { writeCaptionForTask, makeGraphicForTask } from "./graphicAgent";
import { updateTaskFields, updateTaskLabel } from "@/lib/tasks/taskEvents";
import { emitMessageCreated } from "@/lib/chat/messageEvents";
import {
  pauseForImageRequest,
  taskHasAssignedImage,
  isPreImageRequestState,
} from "./postImageRequest";
import { getForProject } from "@/lib/brandKit/store";
import { isProjectPipelinePaused } from "@/lib/queue/pipelinePauseFlag";
import { isPhotoCollectionPause } from "@/lib/tasks/pendingTask";
import { isAgentQuestionPause } from "@/lib/tasks/taskPauseState";
import { hasMarketingReadySummary, isProductDescriptionQuestion } from "@/lib/ai/productContext";
import { getCaptionCorpus } from "@/lib/content/captionCorpus";
import {
  getTaskDeliverableStatus,
  promoteTaskIfDeliverableReady,
} from "@/lib/tasks/deliverable";
import {
  finishPostFromResearchCheckpoint,
  isReadyForCaptionCheckpoint,
} from "./postCheckpoint";
import { formatTaskFailureLabel } from "@/lib/tasks/failureLabel";
import type { AgentLoopResult } from "../agentLoop";

const POST_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "findProduct",
      description:
        "Research the product. Returns readyForCaption:true when Perplexity web research or site/user product info is saved (check webResearchNotesChars). Only returns needsDescription when research is truly thin. Uses user-provided images first.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "Product name to research" } },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "writeCaption",
      description:
        "One LLM call: Facebook caption, on-graphic copy, and creative brief (imagePrompt). App appends copy and brand rules at image generation.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "makeGraphic",
      description: "Generate the Facebook graphic using the caption, product image, and logo.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "askUser",
      description:
        "Pause ONLY when findProduct returns needsDescription:true, noUsableImage:true (and no user photo yet), or found:false. Never call askUser when readyForCaption is true.",
      parameters: {
        type: "object",
        properties: { question: { type: "string" } },
        required: ["question"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are Brewline's per-post content agent. For this Facebook post:
1. findProduct(name) — research the product on the client's site. User-provided sourceImages always win — never overridden.
2. If the task already has sourceImages from the user, proceed with findProduct then writeCaption/makeGraphic.
3. After findProduct:
   - If readyForCaption is true (or webResearchNotesChars >= 200): call writeCaption() then makeGraphic() immediately. Do NOT call askUser — product info is already saved; summary.description may be empty when Perplexity notes were used.
   - If needsDescription is true ONLY: call askUser with suggestedQuestion. Do NOT call writeCaption until the user replies.
   - If noUsableImage is true and the user did not already upload a photo: call askUser with suggestedQuestion offering upload or "generate". (Usually the user already answered via the image request card.)
   - If found:false: call askUser with a specific clarifying question about the product.
4. After askUser resumes, read the tool result:
   - If choice is "description": user explained the product — call writeCaption then makeGraphic.
   - If choice is "upload" or imageUrls present: user attached photo(s) — call writeCaption then makeGraphic unless needsDescription is true in the tool result.
   - If choice is "generate" or user said generate: call writeCaption then makeGraphic without expecting a product photo.
   - Otherwise follow the user's text answer.
5. writeCaption() — one LLM call returns caption, graphicCopy, and imagePrompt (creative brief). Requires product info (Perplexity research, site copy, or user description).
6. makeGraphic() — appends on-graphic copy and brand rules to the creative brief, then sends to the image model with logo + uploaded product photos.

You MUST finish every post with writeCaption then makeGraphic. Call askUser ONLY when findProduct explicitly returns needsDescription, noUsableImage, or found:false — never because description is empty when readyForCaption is true. NEVER end with a plain-text reply.

Emit one tool at a time. User-provided product images are attached at planning time — findProduct returns immediately with imageSource:"user".`;

async function buildPostSystemPrompt(projectId: string): Promise<string> {
  const corpus = await getCaptionCorpus(projectId);
  if (!corpus.trim()) return SYSTEM_PROMPT;
  return `${SYSTEM_PROMPT}\n\nThis client has past captions on file. writeCaption uses them as style reference only — not to copy verbatim — plus product research and any per-post detail.`;
}

const STATUS_LABELS: Record<string, string> = {
  findProduct: "Creating post — researching product…",
  writeCaption: "Creating post — writing caption, graphic copy & image brief…",
  makeGraphic: "Creating post — designing graphic…",
  askUser: "Creating post — need your input…",
  imageRequest: "Waiting for photo…",
};

async function getProjectConversationId(projectId: string): Promise<string> {
  const conv = await prisma.conversation.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!conv) {
    const created = await prisma.conversation.create({ data: { projectId } });
    return created.id;
  }
  return conv.id;
}

function productNameFromTask(task: { subject: string; title: string; productInfo: unknown }) {
  const info = task.productInfo as { name?: string } | null;
  return info?.name ?? task.subject ?? task.title;
}

async function taskHasDeliverable(taskId: string) {
  return getTaskDeliverableStatus(taskId);
}

async function finishIfDeliverableReady(
  taskId: string
): Promise<{ done: boolean; paused: boolean } | null> {
  if (await promoteTaskIfDeliverableReady(taskId)) {
    return { done: true, paused: false };
  }
  return null;
}

async function tryAutoFinishDeliverable(
  taskId: string,
  state: AgentLoopResult["state"],
  autoContinueDepth: number
): Promise<boolean> {
  const deliverable = await taskHasDeliverable(taskId);
  if (deliverable.ok) return true;

  const task = await prisma.task.findUniqueOrThrow({
    where: { id: taskId },
    include: { generations: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  if (task.caption?.trim() && !task.generations[0]?.imagePath) {
    const brandKit = await getForProject(task.projectId);
    if (!brandKit?.complete) return false;
    try {
      await updateTaskLabel(taskId, STATUS_LABELS.makeGraphic);
      await makeGraphicForTask(taskId);
      return (await taskHasDeliverable(taskId)).ok;
    } catch (err) {
      console.warn(`[postAgent] auto makeGraphic failed for ${taskId}:`, err);
      return false;
    }
  }

  if (!task.caption?.trim() && autoContinueDepth < 1 && state.messages.length > 0) {
    if (isReadyForCaptionCheckpoint(state)) {
      try {
        const finished = await finishPostFromResearchCheckpoint(taskId);
        if (finished) return true;
      } catch (err) {
        console.warn(`[postAgent] research checkpoint finish failed for ${taskId}:`, err);
      }
    }

    const defaultName = productNameFromTask(task);
    const handlers = createPostToolHandlers({
      taskId,
      projectId: task.projectId,
      defaultName,
    });
    const systemPrompt = await buildPostSystemPrompt(task.projectId);
    const continued = await runAgentLoop(
      createPostLoopOptions({
        taskId,
        projectId: task.projectId,
        defaultName,
        handlers,
        messages: [
          ...state.messages,
          {
            role: "user",
            content:
              "Continue this post: call writeCaption() then makeGraphic(). Do not stop with a plain-text reply.",
          },
        ],
        systemPrompt,
      })
    );
    const outcome = await handleAgentLoopResult(taskId, continued, autoContinueDepth + 1);
    return outcome.done;
  }

  return false;
}

async function finalizePostAgentRun(
  taskId: string,
  state: ReturnType<typeof serializeAgentState>,
  autoContinueDepth = 0
): Promise<{ done: boolean; paused: boolean }> {
  let deliverable = await taskHasDeliverable(taskId);
  if (!deliverable.ok) {
    const healed = await tryAutoFinishDeliverable(
      taskId,
      deserializeAgentState(state) ?? { messages: [], stepCount: 0 },
      autoContinueDepth
    );
    if (healed) {
      deliverable = await taskHasDeliverable(taskId);
    }
  }

  if (!deliverable.ok) {
    await updateTaskFields(taskId, {
      status: "FAILED",
      statusLabel: formatTaskFailureLabel(deliverable.reason),
      pendingQuestion: null,
      agentState: state as object,
    });
    return { done: false, paused: false };
  }

  await updateTaskFields(taskId, {
    status: "NEEDS_APPROVAL",
    statusLabel: null,
    pendingQuestion: null,
    agentState: state as object,
  });
  return { done: true, paused: false };
}

async function handleAgentLoopResult(
  taskId: string,
  result: AgentLoopResult,
  autoContinueDepth = 0
): Promise<{ done: boolean; paused: boolean }> {
  if (result.aborted) {
    await updateTaskFields(taskId, {
      status: "NOT_STARTED",
      statusLabel: "Paused",
      agentState: {
        ...(serializeAgentState(result.state) as object),
        userPaused: true,
      },
    });
    return { done: false, paused: false };
  }

  if (result.paused) {
    const taskNow = await prisma.task.findUnique({ where: { id: taskId } });
    await updateTaskFields(taskId, {
      status: "NEEDS_INFO",
      statusLabel: STATUS_LABELS.askUser,
      pendingQuestion: taskNow?.pendingQuestion ?? "Need more info to continue this post.",
      agentState: serializeAgentState(result.state) as object,
    });
    return { done: false, paused: true };
  }

  if (result.exhausted || !result.done) {
    const deliverable = await taskHasDeliverable(taskId);
    if (deliverable.ok) {
      return finalizePostAgentRun(taskId, serializeAgentState(result.state), autoContinueDepth);
    }
    const healed = await tryAutoFinishDeliverable(taskId, result.state, autoContinueDepth);
    if (healed) {
      return finalizePostAgentRun(taskId, serializeAgentState(result.state), autoContinueDepth);
    }
    await updateTaskFields(taskId, {
      status: "FAILED",
      statusLabel: "Post generation stopped before caption and graphic were ready — retry",
      agentState: serializeAgentState(result.state) as object,
    });
    return { done: false, paused: false };
  }

  return finalizePostAgentRun(taskId, serializeAgentState(result.state), autoContinueDepth);
}

function createPostLoopOptions(params: {
  taskId: string;
  projectId: string;
  defaultName: string;
  handlers: ReturnType<typeof createPostToolHandlers>;
  messages: LoopMessage[];
  systemPrompt: string;
}) {
  const { taskId, projectId, defaultName, handlers, messages, systemPrompt } = params;
  return {
    model: MODELS.chatAgent.model,
    systemPrompt,
    messages,
    tools: POST_TOOLS,
    maxSteps: 12,
    toolHandlers: handlers,
    shouldAbort: () => isProjectPipelinePaused(projectId),
    onStep: async ({ toolName }: { toolName?: string }) => {
      if (toolName && STATUS_LABELS[toolName]) {
        await updateTaskLabel(taskId, STATUS_LABELS[toolName]);
      }
    },
    persistState: async (state: Parameters<typeof serializeAgentState>[0]) => {
      await prisma.task.update({
        where: { id: taskId },
        data: { agentState: serializeAgentState(state) as object },
      });
    },
  };
}

export async function continuePostAgentFromSavedState(
  taskId: string
): Promise<{ done: boolean; paused: boolean }> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  if (isAgentQuestionPause(task)) {
    return { done: false, paused: true };
  }

  const healed = await finishIfDeliverableReady(taskId);
  if (healed) return healed;

  const state = deserializeAgentState(task.agentState);

  if (!state?.messages?.length) {
    return runPostAgent(taskId, { skipImageRequest: taskHasAssignedImage(task) });
  }

  if (isReadyForCaptionCheckpoint(state)) {
    try {
      const finished = await finishPostFromResearchCheckpoint(taskId);
      if (finished) {
        await updateTaskFields(taskId, {
          status: "NEEDS_APPROVAL",
          statusLabel: null,
          pendingQuestion: null,
          agentState: serializeAgentState(state) as object,
        });
        return { done: true, paused: false };
      }
    } catch (err) {
      await updateTaskFields(taskId, {
        status: "FAILED",
        statusLabel: formatTaskFailureLabel(err instanceof Error ? err.message : String(err)),
        agentState: serializeAgentState(state) as object,
      });
      return { done: false, paused: false };
    }
  }

  await updateTaskFields(taskId, {
    status: "AGENT_RUNNING",
    statusLabel: "Resuming…",
    pendingQuestion: null,
    agentState: serializeAgentState(state) as object,
  });

  const defaultName = productNameFromTask(task);
  const handlers = createPostToolHandlers({
    taskId,
    projectId: task.projectId,
    defaultName,
  });

  const systemPrompt = await buildPostSystemPrompt(task.projectId);
  const result = await runAgentLoop(
    createPostLoopOptions({
      taskId,
      projectId: task.projectId,
      defaultName,
      handlers,
      messages: state.messages,
      systemPrompt,
    })
  );

  return handleAgentLoopResult(taskId, result);
}

function createPostToolHandlers(params: {
  taskId: string;
  projectId: string;
  defaultName: string;
}) {
  const { taskId, projectId, defaultName } = params;

  return {
    findProduct: async (args: Record<string, unknown>) => {
      const name = (args.name as string) || defaultName;
      await updateTaskLabel(taskId, `Researching ${name}…`);
      const result = await findProduct(taskId, name);
      if ("noUsableImage" in result && result.noUsableImage) {
        await updateTaskLabel(taskId, `Need a photo for ${name}…`);
      } else if ("needsDescription" in result && result.needsDescription) {
        await updateTaskLabel(taskId, `Need product details for ${name}…`);
      } else if (result.found) {
        await updateTaskLabel(taskId, `Found ${name} → writing next step…`);
      }
      return JSON.stringify(serializeFindProductResultForAgent(result));
    },

    writeCaption: async () => {
      await updateTaskLabel(taskId, STATUS_LABELS.writeCaption);
      const caption = await writeCaptionForTask(taskId);
      return JSON.stringify({ ok: true, caption });
    },

    makeGraphic: async () => {
      const brandKit = await getForProject(projectId);
      if (!brandKit?.complete) {
        return JSON.stringify({
          error: "Brand kit is incomplete — finish brand setup before generating graphics.",
        });
      }
      await updateTaskLabel(taskId, STATUS_LABELS.makeGraphic);
      const url = await makeGraphicForTask(taskId);
      return JSON.stringify({ ok: true, imageUrl: url });
    },

    askUser: async (args: Record<string, unknown>) => {
      const question = args.question as string;
      const taskNow = await prisma.task.findUnique({ where: { id: taskId } });
      if (
        taskNow &&
        isProductDescriptionQuestion(question) &&
        hasMarketingReadySummary(taskNow.productSummary as Parameters<typeof hasMarketingReadySummary>[0])
      ) {
        return JSON.stringify({
          skipped: true,
          readyForCaption: true,
          message:
            "Product research is already saved on this task — call writeCaption() then makeGraphic(). Do not ask the user again.",
        });
      }

      if (taskNow && isAgentQuestionPause(taskNow)) {
        return {
          content: JSON.stringify({
            paused: true,
            question: taskNow.pendingQuestion ?? question,
          }),
          pause: true,
        };
      }

      const otherWaiting = await prisma.task.findMany({
        where: {
          projectId,
          status: "NEEDS_INFO",
          id: { not: taskId },
        },
        select: { agentState: true },
      });
      const blockedByAgentQuestion = otherWaiting.some(
        (t) => !isPreImageRequestState(t.agentState)
      );
      if (blockedByAgentQuestion) {
        return JSON.stringify({
          error: "Another post is already waiting for user input. Finish that first.",
        });
      }

      const conversationId = await getProjectConversationId(projectId);
      const agentMessage = await prisma.message.create({
        data: {
          conversationId,
          role: "assistant",
          content: question,
          meta: { taskId, type: "agent_question", pendingQuestion: question },
        },
      });
      await emitMessageCreated(projectId, agentMessage);

      await updateTaskFields(taskId, {
        pendingQuestion: question,
        status: "NEEDS_INFO",
        statusLabel: STATUS_LABELS.askUser,
      });

      return {
        content: JSON.stringify({ paused: true, question }),
        pause: true,
      };
    },
  };
}

export async function runPostAgent(
  taskId: string,
  opts?: { skipImageRequest?: boolean }
): Promise<{ done: boolean; paused: boolean }> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  if (task.status === "NEEDS_APPROVAL" || task.status === "APPROVED") {
    return { done: true, paused: false };
  }

  if (isAgentQuestionPause(task)) {
    return { done: false, paused: true };
  }

  const healed = await finishIfDeliverableReady(taskId);
  if (healed) return healed;

  const defaultName = productNameFromTask(task);

  if (!opts?.skipImageRequest) {
    const othersWaiting = await prisma.task.findMany({
      where: {
        projectId: task.projectId,
        status: "NEEDS_INFO",
        id: { not: taskId },
      },
      orderBy: { orderIndex: "asc" },
    });
    if (othersWaiting.some((t) => isPhotoCollectionPause(t))) {
      await updateTaskFields(taskId, { status: "NOT_STARTED", statusLabel: null });
      return { done: false, paused: false };
    }
  }

  if (!taskHasAssignedImage(task) && !opts?.skipImageRequest) {
    return pauseForImageRequest(task, defaultName);
  }

  await updateTaskFields(taskId, {
    status: "AGENT_RUNNING",
    statusLabel: `Creating post → ${task.title}`,
    agentState: (task.agentState as object) ?? { messages: [], stepCount: 0 },
  });

  const seedMessages: LoopMessage[] = [
    {
      role: "user",
      content: `Create a Facebook post for: ${task.title}\nSubject: ${task.subject}\nProduct: ${defaultName}`,
    },
  ];

  const handlers = createPostToolHandlers({
    taskId,
    projectId: task.projectId,
    defaultName,
  });

  const systemPrompt = await buildPostSystemPrompt(task.projectId);
  const result = await runAgentLoop(
    createPostLoopOptions({
      taskId,
      projectId: task.projectId,
      defaultName,
      handlers,
      messages: seedMessages,
      systemPrompt,
    })
  );

  return handleAgentLoopResult(taskId, result);
}

export async function continuePostAgentAfterImageRequest(
  taskId: string,
  userReply: string
): Promise<{ done: boolean; paused: boolean }> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

  if (task.status === "NEEDS_APPROVAL" || task.status === "APPROVED") {
    return { done: true, paused: false };
  }

  const healed = await finishIfDeliverableReady(taskId);
  if (healed) return healed;

  let skipImageRequest = false;
  let pendingContextImageId: string | undefined;
  try {
    const parsed = JSON.parse(userReply) as {
      choice?: string;
      pendingContextImageId?: string;
      imageUrls?: string[];
    };
    skipImageRequest =
      parsed.choice === "generate" ||
      parsed.choice === "upload" ||
      Boolean(parsed.imageUrls?.length);
    pendingContextImageId = parsed.pendingContextImageId;
  } catch {
    /* plain text reply */
  }

  if (pendingContextImageId) {
    const productName = productNameFromTask(task);
    await applyPendingContextImageNotes({
      projectId: task.projectId,
      taskId,
      productName,
      contextImageId: pendingContextImageId,
    });
  }

  await updateTaskFields(taskId, {
    status: "AGENT_RUNNING",
    statusLabel: skipImageRequest ? "Creating post — designing from scratch…" : "Creating post — photo received…",
    pendingQuestion: null,
    agentState: {
      messages: [],
      stepCount: 0,
      remainingTaskIds:
        (task.agentState as { remainingTaskIds?: string[] } | null)?.remainingTaskIds ?? [],
    },
  });

  return runPostAgent(taskId, { skipImageRequest });
}

export async function resumePostAgent(taskId: string, userReply: string): Promise<{
  done: boolean;
  paused: boolean;
}> {
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const state = deserializeAgentState(task.agentState);
  if (!state) throw new Error("No agent state to resume");

  const resumed = appendResumeToolResult(state, userReply);
  await updateTaskFields(taskId, {
    status: "AGENT_RUNNING",
    statusLabel: "Resuming…",
    pendingQuestion: null,
    agentState: serializeAgentState(resumed) as object,
  });

  const taskFresh = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });
  const defaultName = productNameFromTask(taskFresh);
  const handlers = createPostToolHandlers({
    taskId,
    projectId: taskFresh.projectId,
    defaultName,
  });

  const systemPrompt = await buildPostSystemPrompt(taskFresh.projectId);
  const result = await runAgentLoop(
    createPostLoopOptions({
      taskId,
      projectId: taskFresh.projectId,
      defaultName,
      handlers,
      messages: resumed.messages,
      systemPrompt,
    })
  );

  return handleAgentLoopResult(taskId, result);
}
