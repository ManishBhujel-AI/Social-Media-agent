import { NextRequest, NextResponse } from "next/server";
import { getForProject, getProjectWithBrandKit } from "@/lib/brandKit/store";
import { revertProjectChangelogEntry } from "@/lib/brandKit/settingsApply";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> }
) {
  const { id, entryId } = await params;
  const project = await getProjectWithBrandKit(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  if (!entryId?.trim()) {
    return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  }

  const result = await revertProjectChangelogEntry(id, entryId);
  if (!result.ok) {
    const status = result.error.includes("already reverted") ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  const brandKit = await getForProject(id);
  return NextResponse.json({
    ok: true,
    entry: result.entry,
    brandKit,
  });
}
