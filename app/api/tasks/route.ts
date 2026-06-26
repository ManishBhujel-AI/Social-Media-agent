import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { resolveSourceImages } from "@/lib/ai/resolveSourceImages";
import { startPipelineForTasks } from "@/lib/queue/pipeline";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { projectId, posts } = body as {
    projectId: string;
    posts: Array<{
      title: string;
      subject: string;
      productInfo?: object;
      businessInfo?: object;
      sourceImages?: string[];
      orderIndex: number;
    }>;
  };

  if (!projectId || !posts?.length) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  const biz = (project.businessInfo as object) ?? {};
  const businessSummary = (project.businessSummary as object) ?? {};
  const logoUrl = project.logoUrl ?? null;

  const resolvedPosts = await Promise.all(
    posts.map(async (p) => ({
      ...p,
      sourceImages: await resolveSourceImages(projectId, p.sourceImages),
    }))
  );

  const created = await prisma.$transaction(
    resolvedPosts.map((p) =>
      prisma.task.create({
        data: {
          projectId,
          title: p.title,
          subject: p.subject,
          productInfo: (p.productInfo ?? {}) as object,
          businessInfo: (p.businessInfo ?? biz) as object,
          businessSummary,
          logoUrl,
          sourceImages: (p.sourceImages ?? []) as object,
          orderIndex: p.orderIndex,
        },
      })
    )
  );

  await startPipelineForTasks(created.map((t) => t.id));
  return NextResponse.json({ tasks: created });
}
