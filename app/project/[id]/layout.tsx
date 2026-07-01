import { prisma } from "@/lib/db/prisma";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import type { BriefSummary } from "@/lib/types/brief";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [project, briefs] = await Promise.all([
    prisma.project.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        tasks: { select: { id: true, status: true } },
      },
    }),
    prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { tasks: true } },
      },
    }),
  ]);

  if (!project) notFound();

  const needsCount = project.tasks.filter((t) => t.status === "NEEDS_APPROVAL").length;

  const briefSummaries: BriefSummary[] = briefs.map((b) => ({
    id: b.id,
    name: b.name,
    createdAt: b.createdAt.toISOString(),
    taskCount: b._count.tasks,
  }));

  return (
    <AppShell
      projectId={id}
      projectName={project.name}
      taskCount={project.tasks.length}
      needsCount={needsCount}
      initialTaskStatuses={project.tasks.map((t) => ({ id: t.id, status: t.status }))}
      briefs={briefSummaries}
    >
      {children}
    </AppShell>
  );
}
