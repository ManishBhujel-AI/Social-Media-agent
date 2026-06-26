import { NextRequest, NextResponse } from "next/server";
import {
  completenessOptsForProject,
  getForProject,
  getProjectWithBrandKit,
  saveKitForProject,
} from "@/lib/brandKit/store";
import {
  normalizeBrandKitData,
  type BrandKitData,
  type BrandKitFieldName,
  type FieldSource,
} from "@/lib/brandKit/types";

const SCALAR_FIELDS: BrandKitFieldName[] = [
  "businessName",
  "website",
  "location",
  "businessType",
  "audience",
  "tone",
  "heritage",
  "themeWords",
  "contact",
  "contactStyle",
  "aspectRatio",
];

function kitFromPatchBody(body: Record<string, unknown>, existing?: BrandKitData): BrandKitData {
  const base = existing ?? normalizeBrandKitData({});
  const kit = normalizeBrandKitData({
    ...base,
    ...body,
    colors: body.colors ?? base.colors,
    avoidColors: body.avoidColors ?? base.avoidColors,
    sources: { ...base.sources },
    skipped: { ...base.skipped },
  });

  for (const field of SCALAR_FIELDS) {
    if (field in body) {
      kit.sources[field] = "user";
    }
  }
  if ("colors" in body) kit.sources.colors = "user";
  if ("avoidColors" in body) {
    kit.sources.avoidColors = "user";
    if (Array.isArray(body.avoidColors) && body.avoidColors.length === 0) {
      kit.skipped.avoidColors = false;
    }
  }

  if (typeof body.businessSummary === "string") {
    kit.businessSummary = body.businessSummary;
    kit.sources.businessSummary = "user";
  }

  return kit;
}

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
  return NextResponse.json({
    brandKit,
    hasClientUrl: Boolean(project.clientUrl?.trim()),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await getProjectWithBrandKit(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = project.brandKit
    ? normalizeBrandKitData(project.brandKit.kit)
    : undefined;

  try {
    const kit = kitFromPatchBody(body, existing);
    const saved = await saveKitForProject(id, kit);
    return NextResponse.json({
      brandKit: saved,
      hasClientUrl: completenessOptsForProject(project.clientUrl).hasClientUrl,
    });
  } catch (err) {
    console.error("brand-kit PATCH failed:", err);
    return NextResponse.json({ error: "Could not save brand kit" }, { status: 500 });
  }
}

export type { BrandKitData, FieldSource };
