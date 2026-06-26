import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { HomeEmpty } from "@/components/shell/HomeEmpty";

export const dynamic = "force-dynamic";

export default async function Home() {
  const newest = await prisma.project.findFirst({ orderBy: { createdAt: "desc" } });
  if (newest) {
    redirect(`/project/${newest.id}/chat`);
  }
  return <HomeEmpty />;
}
