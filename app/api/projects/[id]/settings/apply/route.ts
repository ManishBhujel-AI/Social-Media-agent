import { NextRequest, NextResponse } from "next/server";
import { getForProject, getProjectWithBrandKit } from "@/lib/brandKit/store";
import { applyProjectSettingsPatches } from "@/lib/brandKit/settingsApply";
import type { SettingsPatchItem } from "@/lib/brandKit/types";

function parsePatches(body: unknown): SettingsPatchItem[] | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { patches?: unknown }).patches;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const patches: SettingsPatchItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const path = (item as { path?: unknown }).path;
    if (typeof path !== "string" || !path.trim()) return null;
    patches.push({
      path: path.trim(),
      value: (item as { value?: unknown }).value,
    });
  }
  return patches;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await getProjectWithBrandKit(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patches = parsePatches(body);
  if (!patches) {
    return NextResponse.json({ error: "patches array is required" }, { status: 400 });
  }

  const summary =
    body && typeof body === "object" && typeof (body as { summary?: unknown }).summary === "string"
      ? (body as { summary: string }).summary
      : "";
  const sourceRaw =
    body && typeof body === "object" ? (body as { source?: unknown }).source : undefined;
  const source = sourceRaw === "agent" ? "agent" : "user";

  const result = await applyProjectSettingsPatches(id, patches, { summary, source });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const brandKit = await getForProject(id);
  return NextResponse.json({
    ok: true,
    entry: result.entry,
    brandKit,
  });
}
