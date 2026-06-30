import { prisma } from "@/lib/db/prisma";
import { HomeEmpty } from "@/components/shell/HomeEmpty";
import { WorkspaceHome } from "@/components/shell/WorkspaceHome";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspaces = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: { select: { tasks: true } },
    },
  });

  if (workspaces.length === 0) {
    return <HomeEmpty />;
  }

  return (
    <WorkspaceHome
      workspaces={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        createdAt: w.createdAt.toISOString(),
        taskCount: w._count.tasks,
      }))}
    />
  );
}
