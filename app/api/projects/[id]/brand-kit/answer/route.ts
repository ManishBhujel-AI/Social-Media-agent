import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  advanceBrandKitGapFill,
  findPendingBrandKitQuestion,
  saveFieldAnswer,
} from "@/lib/brandKit/gapFill";
import { getForProject } from "@/lib/brandKit/store";
import type { BrandKitFieldName } from "@/lib/brandKit/types";
import { emitMessageCreated } from "@/lib/chat/messageEvents";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const body = (await req.json()) as {
    conversationId?: string;
    field?: string;
    answer?: string;
    skipped?: boolean;
  };

  const conversationId = body.conversationId?.trim();
  const field = body.field as BrandKitFieldName | undefined;

  if (!conversationId || !field) {
    return NextResponse.json({ error: "conversationId and field are required" }, { status: 400 });
  }

  const pending = await findPendingBrandKitQuestion(conversationId);
  if (!pending || pending.field !== field) {
    return NextResponse.json(
      { error: "No active brand setup question for that field" },
      { status: 409 }
    );
  }

  if (!body.skipped && !body.answer?.trim()) {
    return NextResponse.json({ error: "answer is required" }, { status: 400 });
  }

  await saveFieldAnswer(projectId, field, body.answer ?? "", { skipped: body.skipped });

  const userContent = body.skipped
    ? "Skipped — none for this brand"
    : (body.answer ?? "").trim();

  const userMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "user",
      content: userContent,
      meta: { type: "brand_kit_reply", field },
    },
  });
  await emitMessageCreated(projectId, userMessage);

  const brandKit = await getForProject(projectId);
  const ack =
    brandKit?.complete === true
      ? "Thanks — brand setup is complete."
      : "Saved — one more brand detail to go.";

  const ackMessage = await prisma.message.create({
    data: {
      conversationId,
      role: "assistant",
      content: ack,
      meta: { type: "brand_kit_ack", field },
    },
  });
  await emitMessageCreated(projectId, ackMessage);

  const advanced = await advanceBrandKitGapFill(projectId, conversationId);

  return NextResponse.json({
    ok: true,
    complete: advanced.complete,
    message: ack,
  });
}
