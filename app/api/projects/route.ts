import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { tasks: true } },
    },
  });

  return NextResponse.json(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      taskCount: p._count.tasks,
    }))
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name } = body;
  const project = await prisma.project.create({
    data: {
      name: name ?? "New brief",
      conversations: { create: {} },
    },
    include: { conversations: true },
  });
  return NextResponse.json(project);
}
