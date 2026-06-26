import { NextRequest, NextResponse } from "next/server";
import { pauseProjectPipeline } from "@/lib/queue/pipelinePause";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const pausedCount = await pauseProjectPipeline(projectId);
  return NextResponse.json({ ok: true, paused: true, pausedCount });
}
