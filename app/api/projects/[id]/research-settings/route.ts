import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { alwaysWebResearch: true },
  });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ alwaysWebResearch: project.alwaysWebResearch });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body.alwaysWebResearch !== "boolean") {
    return NextResponse.json(
      { error: "alwaysWebResearch must be a boolean" },
      { status: 400 }
    );
  }

  try {
    const project = await prisma.project.update({
      where: { id },
      data: { alwaysWebResearch: body.alwaysWebResearch },
      select: { alwaysWebResearch: true },
    });
    return NextResponse.json(project);
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}
