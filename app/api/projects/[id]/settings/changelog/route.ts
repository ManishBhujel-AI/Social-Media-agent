import { NextRequest, NextResponse } from "next/server";
import { getForProject, getProjectWithBrandKit } from "@/lib/brandKit/store";
import { revertProjectChangelogEntry } from "@/lib/brandKit/settingsApply";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await getProjectWithBrandKit(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const brandKit = await getForProject(id);
  const changelog = brandKit?.kit.settingsChangelog ?? [];

  return NextResponse.json({
    changelog: [...changelog].reverse(),
  });
}
