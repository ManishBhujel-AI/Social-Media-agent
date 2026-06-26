import { MODELS } from "../models.config";
import { runAgentLoop, type LoopMessage } from "../agentLoop";
import type { ToolDef } from "../openrouter";
import { isAbortError } from "../abort";
import { prisma } from "@/lib/db/prisma";
import {
  createPlanningToolHandlers,
  type PlanningContext,
} from "./planningTools";
import { createPageFetchCache } from "@/lib/web/pageFetchCache";
import { getPlanningBrandContext } from "@/lib/brandKit/ensureBrandKit";
import { emitAgentActivity } from "@/lib/chat/agentActivity";
import { labelForAgentActivity } from "@/lib/chat/agentActivityLabels";
import { looksLikeInternalJson } from "@/lib/chat/displayMessages";
import { ingestUserReference } from "@/lib/content/ingestUserReference";
import { ensureConfirmedPlanningTasks } from "@/lib/ai/agents/ensurePlanningTasks";
import { verifyAndSaveProjectLogo } from "./projectLogo";
import {
  formatProjectReferencesSummary,
  getProjectReferences,
} from "@/lib/content/references";

const INTERNAL_JSON_FALLBACK = "Logo saved — I'll use it on your graphics.";

function sanitizeAssistantContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return content;
  return looksLikeInternalJson(trimmed) ? INTERNAL_JSON_FALLBACK : content;
}

export const PLANNING_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "ensureBrandKit",
      description:
        "Load or extract the client brand kit from their website URL. Saves to Client Settings. Reuses existing data for this client domain — does not re-fetch unless force is true. Also returns business summary with products/services.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Client website URL" },
          force: {
            type: "boolean",
            description: "Re-scan the site only when the user explicitly asks to refresh brand info",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "initBrandKit",
      description:
        "Initialize brand kit from a free-text business description when no website is available or site fetch failed. Saves partial kit and starts brand setup questions for missing fields.",
      parameters: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "User's description of their business",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "setProjectLogo",
      description:
        "Set the project logo from an uploaded image ID after the user explicitly uploads their logo in chat. Never use product/work photos as the logo. Post photos are uploaded via per-post cards, not chat.",
      parameters: {
        type: "object",
        properties: {
          imageId: { type: "string", description: "UploadedImage ID of the logo file" },
        },
        required: ["imageId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "saveContentReference",
      description:
        "Explicitly save user-provided copy or style guidance when they ask you to use it for posts. Prefer automatic ingestion for pasted captions; use this when the user says e.g. 'use this tone for all posts'.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["caption_example", "copy_snippet", "brand_voice", "style_graphic", "old_post_graphic"],
          },
          scope: { type: "string", enum: ["project", "task"] },
          taskId: { type: "string", description: "Required when scope is task" },
          text: { type: "string" },
          imageId: { type: "string" },
          summary: { type: "string" },
          styleNotes: { type: "string" },
        },
        required: ["kind", "scope", "summary"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createTasks",
      description:
        "Create one task per confirmed post. Call as soon as the user confirms. Each post needs title, subject/product name, productInfo.name. Do NOT pass product photos — each post gets its own photo upload card in the chat UI.",
      parameters: {
        type: "object",
        properties: {
          posts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                subject: { type: "string" },
                productInfo: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
                orderIndex: { type: "number" },
              },
              required: ["title", "subject", "orderIndex"],
            },
          },
        },
        required: ["posts"],
      },
    },
  },
];

const BRAND_SETUP_PROMPT = `You are Brewline's brand setup assistant. For new clients, your FIRST priority is completing brand setup — not creating posts.

Do NOT discuss posts, campaigns, or content plans until brand setup is complete.

Workflow:
1. If no website on file, ask for their website URL once, then call ensureBrandKit(url).
2. If ensureBrandKit fails (site unreachable), call initBrandKit({ description }) using what the user told you.
3. After ensureBrandKit/initBrandKit, if brand kit is incomplete: tell the user to answer the brand setup card(s) above. Cards ask one question at a time — do NOT repeat those questions in plain text.
4. Do NOT call createTasks until brand kit is complete.
5. Logo is optional — if they upload one in chat, call setProjectLogo(imageId). You may mention logo once, briefly. Do NOT ask for product/work photos — those are uploaded later via per-post cards.
6. Bracketed internal context on user messages (logo verify, references) is for you only — respond naturally in your own words; never paste boilerplate like "Saved your logo".

Keep messages short and focused on finishing brand setup. Be warm and professional.`;

const PLANNING_PROMPT = `You are Brewline's social content planning agent. Brand setup is already complete — do NOT mention brand kit, Client Settings, website URL, or brand setup unless the user explicitly asks to change brand info.

Workflow:
1. Ask which products/services to post about and how many posts.
2. After the user confirms which products/services and how many posts, ask once whether they have a company logo to upload for their graphics. They can attach it with the + button in chat or say they don't have one — you must ask this once before creating posts. Do NOT ask for product or work photos in chat.
3. When the user uploads a logo, call setProjectLogo(imageId). Never use a product photo as the logo.
4. If the user already confirmed which posts to create, call createTasks in the SAME turn as setProjectLogo — before you tell them about photo cards. Never say you are creating posts without calling createTasks.
5. Tell the user that each post will have its own photo card above the chat — they upload photos one at a time there (not in the message box). This keeps graphics aligned with their actual products.
6. Welcome pasted old captions, product info, FAQs, and brand voice notes — they are saved automatically and used when writing posts. Welcome style graphic uploads (finished ads, screenshots) for layout inspiration — not product photos.
7. If the user uploads product photos in chat anyway, politely redirect them to the per-post photo cards. Do not attach chat photos to posts.
8. If they ask you to save something explicitly, call saveContentReference.
9. Ask clarifying questions only when needed (product names, post count).
10. When the user confirms (e.g. "create the posts", "go ahead"), call createTasks immediately — one entry per post. If logo is not on file yet, ask about the logo first (step 2) unless they already declined.
11. Internal bracketed context on user messages is for you only — respond naturally; never paste "Saved..." boilerplate.

Each createTasks post needs: title, subject (product name), productInfo: { name }, orderIndex.

Be warm and professional.`;

async function buildSystemPrompt(projectId: string): Promise<string> {
  const { brandKit, hasWebsiteOnFile } = await getPlanningBrandContext(projectId);

  const needsBrandSetup =
    !hasWebsiteOnFile ||
    !brandKit?.kit.businessName?.trim() ||
    !brandKit.complete;

  if (needsBrandSetup) {
    const lines = [BRAND_SETUP_PROMPT, "", "CLIENT STATUS: Brand setup required."];

    if (brandKit?.kit.businessName?.trim()) {
      lines.push(`- Business: ${brandKit.kit.businessName}`);
      lines.push(`- Brand kit complete: no`);
      if (brandKit.missingFields.length) {
        lines.push(`- Still needed: ${brandKit.missingFields.join(", ")}`);
      }
      lines.push("Tell the user to answer the brand setup card(s) above. Do not discuss posts yet.");
    } else {
      lines.push("Ask for their website URL, then call ensureBrandKit(url).");
    }

    return lines.join("\n");
  }

  const website = brandKit!.website ?? brandKit!.kit.website ?? "";
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { logoUrl: true },
  });
  const hasLogo = Boolean(project?.logoUrl?.trim());
  const logoLine = hasLogo
    ? "- Logo: already on file — do not ask again unless they want to change it"
    : "- Logo: not uploaded — ask once before createTasks (optional for them, required for you to ask)";

  const refs = await getProjectReferences(projectId);
  const refLine = refs.length
    ? `\n${formatProjectReferencesSummary(refs)}\nUse saved references when planning tone and product details.`
    : "";

  return `${PLANNING_PROMPT}

CLIENT STATUS: Brand kit complete.
- Business: ${brandKit!.kit.businessName}
- Website: ${website}
${logoLine}${refLine}
Proceed with post planning. Do not mention brand setup.`;
}

function loadHistoryMessages(
  history: Array<{ role: string; content: string; meta: unknown }>
): LoopMessage[] {
  const messages: LoopMessage[] = [];
  for (const m of history) {
    if (m.role === "tool" && m.meta && typeof m.meta === "object") {
      const meta = m.meta as { toolCallId?: string; name?: string };
      messages.push({
        role: "tool",
        content: m.content,
        tool_call_id: meta.toolCallId,
        name: meta.name,
      });
      continue;
    }
    if (m.role === "user" || m.role === "assistant") {
      messages.push({ role: m.role, content: m.content });
    }
  }
  return messages;
}

async function persistLoopMessages(
  conversationId: string,
  priorCount: number,
  messages: LoopMessage[],
  finalContent?: string
): Promise<void> {
  const newMessages = messages.slice(priorCount);
  for (const msg of newMessages) {
    if (msg.role === "tool") {
      await prisma.message.create({
        data: {
          conversationId,
          role: "tool",
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
          meta: { toolCallId: msg.tool_call_id, name: msg.name },
        },
      });
    }
  }
  const assistantContent = finalContent?.trim()
    ? sanitizeAssistantContent(finalContent)
    : undefined;
  if (assistantContent) {
    await prisma.message.create({
      data: { conversationId, role: "assistant", content: assistantContent },
    });
  }
}

export function streamChat(params: {
  projectId: string;
  conversationId: string;
  userMessage: string;
  imageIds?: string[];
  signal?: AbortSignal;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let closed = false;

  const abortFromClient = () => {
    closed = true;
  };
  params.signal?.addEventListener("abort", abortFromClient, { once: true });

  return new ReadableStream({
    async start(controller) {
      const safeEnqueue = (text: string) => {
        if (closed || params.signal?.aborted) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed (client disconnected) */
        }
      };
      const pageCache = createPageFetchCache({ projectId: params.projectId });

      let streamedContent = "";

      try {
        if (params.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        const history = await prisma.message.findMany({
          where: { conversationId: params.conversationId },
          orderBy: { createdAt: "asc" },
          take: 40,
        });

        const seedMessages = loadHistoryMessages(history);

        let userContent = params.userMessage;
        if (params.imageIds?.length) {
          userContent += `\n[Attached image IDs: ${params.imageIds.join(", ")}]`;
        }

        const planningCtx: PlanningContext = {
          projectId: params.projectId,
          conversationId: params.conversationId,
          pageCache,
        };

        const userMsg = await prisma.message.create({
          data: {
            conversationId: params.conversationId,
            role: "user",
            content: params.userMessage,
            meta: params.imageIds?.length ? { imageIds: params.imageIds } : undefined,
          },
        });

        const agentContextNotes: string[] = [];
        const project = await prisma.project.findUnique({
          where: { id: params.projectId },
          select: { logoUrl: true },
        });

        if (params.imageIds?.length === 1 && !project?.logoUrl) {
          try {
            const logo = await verifyAndSaveProjectLogo(params.projectId, params.imageIds[0]);
            if (logo.ok) {
              agentContextNotes.push(
                "Logo upload: vision verified as company logo; saved on project."
              );
            } else if (logo.detectedKind === "product_photo") {
              agentContextNotes.push(
                "Logo upload: NOT saved — image looks like a product photo, not a logo."
              );
            } else {
              agentContextNotes.push(
                `Logo upload: NOT saved — does not look like a company logo (${logo.detectedKind ?? "unknown"}).`
              );
            }
          } catch {
            agentContextNotes.push("Logo upload: verification failed — ask user to try again.");
          }
        }

        const logoUploadHandled =
          params.imageIds?.length === 1 && !project?.logoUrl;
        const worthIngest =
          params.userMessage.trim().length > 80 ||
          (Boolean(params.imageIds?.length) && !logoUploadHandled);
        if (worthIngest) {
          try {
            const ingest = await ingestUserReference({
              projectId: params.projectId,
              conversationId: params.conversationId,
              messageId: userMsg.id,
              text: params.userMessage,
              imageIds: params.imageIds,
            });
            agentContextNotes.push(...ingest.agentNotes);
          } catch (err) {
            console.warn("[streamChat] reference ingest failed:", err);
          }
        }

        if (agentContextNotes.length) {
          userContent += `\n[Internal context — respond naturally in your own words, do not quote this block:\n${agentContextNotes.join("\n")}]`;
        }

        const priorCount = seedMessages.length;
        seedMessages.push({ role: "user", content: userContent });

        const toolHandlers = createPlanningToolHandlers(planningCtx);
        const systemPrompt = await buildSystemPrompt(params.projectId);

        const result = await runAgentLoop({
          model: MODELS.chatAgent.model,
          systemPrompt,
          messages: seedMessages,
          tools: PLANNING_TOOLS,
          maxSteps: 8,
          toolHandlers,
          streamTokens: true,
          signal: params.signal,
          onTurnStart: async () => {
            if (params.signal?.aborted) return;
            await emitAgentActivity(params.projectId, {
              label: labelForAgentActivity(),
            });
          },
          onStep: async ({ toolName, toolArgs }) => {
            if (params.signal?.aborted) return;
            if (toolName === "createTasks") return;
            await emitAgentActivity(params.projectId, {
              label: labelForAgentActivity(toolName, toolArgs),
              toolName,
            });
          },
          onToken: (chunk) => {
            const candidate = streamedContent + chunk;
            if (looksLikeInternalJson(chunk) || looksLikeInternalJson(candidate)) {
              return;
            }
            streamedContent += chunk;
            safeEnqueue(chunk);
          },
        });

        if (params.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }

        let finalContent =
          result.finalContent ??
          (streamedContent.trim() || undefined) ??
          "I've updated the plan — let me know if you'd like to adjust anything.";
        finalContent = sanitizeAssistantContent(finalContent);

        if (!streamedContent.trim() && finalContent) {
          safeEnqueue(finalContent);
        }

        await persistLoopMessages(
          params.conversationId,
          priorCount + 1,
          result.messages,
          finalContent
        );

        try {
          await ensureConfirmedPlanningTasks(
            planningCtx,
            result.messages,
            params.userMessage
          );
        } catch (err) {
          console.warn("[streamChat] ensureConfirmedPlanningTasks failed:", err);
        }
      } catch (err) {
        if (isAbortError(err) || params.signal?.aborted) {
          if (streamedContent.trim()) {
            try {
              await prisma.message.create({
                data: {
                  conversationId: params.conversationId,
                  role: "assistant",
                  content: streamedContent.trim(),
                },
              });
            } catch {
              /* ignore persist failure */
            }
          }
          return;
        }
        console.error("streamChat failed:", err);
        const fallback =
          "Sorry, something went wrong during brand setup. Please send your website URL again, or fill in the missing fields using the setup card above.";
        safeEnqueue(fallback);
        try {
          await prisma.message.create({
            data: {
              conversationId: params.conversationId,
              role: "assistant",
              content: fallback,
            },
          });
        } catch {
          /* ignore persist failure */
        }
      } finally {
        params.signal?.removeEventListener("abort", abortFromClient);
        safeClose();
      }
    },
    cancel() {
      closed = true;
      params.signal?.removeEventListener("abort", abortFromClient);
    },
  });
}

/** @deprecated Use PLANNING_TOOLS */
export const CHAT_TOOLS = PLANNING_TOOLS;
