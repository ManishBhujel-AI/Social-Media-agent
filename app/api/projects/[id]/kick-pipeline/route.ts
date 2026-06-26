import { NextRequest, NextResponse } from "next/server";
import { bootstrapImageCollectionIfStalled } from "@/lib/queue/pipelineGate";

/** Bootstrap stalled image collection and recover submitted posts stuck at NOT_STARTED. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const kicked = await bootstrapImageCollectionIfStalled(projectId);

  return NextResponse.json({ ok: true, kicked });
}
