import { NextRequest, NextResponse } from "next/server";
import { bootstrapImageCollectionIfStalled } from "@/lib/queue/pipelineGate";

/** Bootstrap stalled image collection and recover submitted posts stuck at NOT_STARTED. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const conversationId = req.nextUrl.searchParams.get("conversation") ?? undefined;
  const scope = conversationId ? { conversationId } : undefined;

  const kicked = await bootstrapImageCollectionIfStalled(projectId, scope);

  return NextResponse.json({ ok: true, kicked });
}
