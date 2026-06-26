import { NextRequest, NextResponse } from "next/server";
import { resumeProjectPipeline } from "@/lib/queue/pipelinePause";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;
  const resumedCount = await resumeProjectPipeline(projectId);
  return NextResponse.json({ ok: true, paused: false, resumedCount });
}
