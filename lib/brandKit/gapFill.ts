import { prisma } from "@/lib/db/prisma";
import { emitMessageCreated } from "@/lib/chat/messageEvents";
import {
  completenessOptsForProject,
  getForProject,
  getProjectWithBrandKit,
  saveKitForProject,
} from "./store";
import {
  getNextMissingField,
  isBrandKitComplete,
  SKIPPABLE_FIELDS,
  type BrandKitData,
  type BrandKitFieldName,
} from "./types";
import { parseAvoidColorsAnswer, parseColorAnswer } from "./parseColorAnswer";

export type BrandKitQuestionMeta = {
  type: "brand_kit_question";
  field: BrandKitFieldName;
  pendingQuestion: string;
  allowSkip: boolean;
};

export type BrandKitReplyMeta = {
  type: "brand_kit_reply";
  field: BrandKitFieldName;
};

export function buildQuestionForField(field: BrandKitFieldName): {
  question: string;
  allowSkip: boolean;
} {
  const allowSkip = SKIPPABLE_FIELDS.includes(field as (typeof SKIPPABLE_FIELDS)[number]);

  const questions: Record<BrandKitFieldName, string> = {
    businessName: "What's your business name?",
    businessType: "What type of business is this? (e.g. coffee shop, plumbing company)",
    location:
      "Where is the business located? List all branches or service areas if there are multiple.",
    audience: "Who are these posts mainly for — trade pros, or general customers?",
    tone: "How should you sound — more polished and formal, or plainspoken and friendly?",
    colors:
      "I pulled some brand colors from your site — any to add or remove? List primary/secondary/accent with hex if you can.",
    contact:
      "What phone number or handle should appear on the graphics, and any preference for how it looks?",
    website: "What's the business website URL?",
    heritage:
      "Anything about your history worth featuring — founding year, family-owned, milestones?",
    themeWords: "What words capture the brand feel or location vibe? (e.g. tropical, ocean, summer)",
    avoidColors:
      "Anything you definitely don't want in your posts — colors, words, imagery?",
    contactStyle: "",
    aspectRatio: "",
  };

  return { question: questions[field], allowSkip };
}

function parseFieldValue(field: BrandKitFieldName, rawAnswer: string): Partial<BrandKitData> {
  const trimmed = rawAnswer.trim();
  switch (field) {
    case "colors":
      return { colors: parseColorAnswer(trimmed) };
    case "avoidColors":
      return { avoidColors: parseAvoidColorsAnswer(trimmed) };
    default:
      return { [field]: trimmed } as Partial<BrandKitData>;
  }
}

export async function saveFieldAnswer(
  projectId: string,
  field: BrandKitFieldName,
  rawAnswer: string,
  opts?: { skipped?: boolean }
): Promise<void> {
  const view = await getForProject(projectId);
  if (!view) throw new Error("Brand kit not found");

  const kit: BrandKitData = { ...view.kit, sources: { ...view.kit.sources }, skipped: { ...view.kit.skipped } };

  if (opts?.skipped) {
    kit.skipped[field] = true;
    kit.sources[field] = "user";
    if (field === "avoidColors") kit.avoidColors = [];
    else if (field === "heritage" || field === "themeWords") {
      (kit as Record<string, unknown>)[field] = "";
    }
  } else {
    Object.assign(kit, parseFieldValue(field, rawAnswer));
    kit.sources[field] = "user";
    kit.skipped[field] = false;
  }

  await saveKitForProject(projectId, kit);
}

export async function findPendingBrandKitQuestion(conversationId: string): Promise<{
  messageId: string;
  field: BrandKitFieldName;
  pendingQuestion: string;
  allowSkip: boolean;
} | null> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, meta: true },
  });

  let pending: {
    messageId: string;
    field: BrandKitFieldName;
    pendingQuestion: string;
    allowSkip: boolean;
  } | null = null;

  for (const m of messages) {
    if (!m.meta || typeof m.meta !== "object") continue;
    const meta = m.meta as Record<string, unknown>;

    if (meta.type === "brand_kit_reply" && typeof meta.field === "string") {
      if (pending?.field === meta.field) pending = null;
      continue;
    }

    if (meta.type === "brand_kit_question" && typeof meta.field === "string") {
      pending = {
        messageId: m.id,
        field: meta.field as BrandKitFieldName,
        pendingQuestion:
          typeof meta.pendingQuestion === "string" ? meta.pendingQuestion : "",
        allowSkip: meta.allowSkip === true,
      };
    }
  }

  return pending;
}

export async function postBrandKitQuestion(
  projectId: string,
  conversationId: string,
  field: BrandKitFieldName
): Promise<void> {
  const { question, allowSkip } = buildQuestionForField(field);
  const message = await prisma.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: question,
      meta: {
        type: "brand_kit_question",
        field,
        pendingQuestion: question,
        allowSkip,
      } satisfies BrandKitQuestionMeta,
    },
  });
  await emitMessageCreated(projectId, message);
}

async function postBrandKitComplete(projectId: string, conversationId: string): Promise<void> {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role: "assistant",
      content:
        "Brand setup complete — your brand kit is saved. You can continue planning posts or edit details anytime in Client Settings.",
      meta: { type: "brand_kit_complete" },
    },
  });
  await emitMessageCreated(projectId, message);
}

export async function startBrandKitGapFill(
  projectId: string,
  conversationId: string
): Promise<{ started: boolean; field?: BrandKitFieldName }> {
  const project = await getProjectWithBrandKit(projectId);
  const view = await getForProject(projectId);
  if (!project || !view) return { started: false };

  const opts = completenessOptsForProject(project.clientUrl);
  if (isBrandKitComplete(view.kit, opts)) return { started: false };

  const pending = await findPendingBrandKitQuestion(conversationId);
  if (pending) return { started: false, field: pending.field };

  const field = getNextMissingField(view.kit, opts);
  if (!field) return { started: false };

  await postBrandKitQuestion(projectId, conversationId, field);
  return { started: true, field };
}

export async function advanceBrandKitGapFill(
  projectId: string,
  conversationId: string
): Promise<{ complete: boolean; nextField?: BrandKitFieldName }> {
  const project = await getProjectWithBrandKit(projectId);
  const view = await getForProject(projectId);
  if (!project || !view) return { complete: false };

  const opts = completenessOptsForProject(project.clientUrl);
  if (isBrandKitComplete(view.kit, opts)) {
    await postBrandKitComplete(projectId, conversationId);
    return { complete: true };
  }

  const field = getNextMissingField(view.kit, opts);
  if (!field) {
    await postBrandKitComplete(projectId, conversationId);
    return { complete: true };
  }

  await postBrandKitQuestion(projectId, conversationId, field);
  return { complete: false, nextField: field };
}
