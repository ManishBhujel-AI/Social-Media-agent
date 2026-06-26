import { getForProject, getProjectWithBrandKit } from "@/lib/brandKit/store";
import { BrandKitForm } from "@/components/settings/BrandKitForm";
import { ProjectResearchSettings } from "@/components/settings/ProjectResearchSettings";
import { PAGE_PADDING } from "@/lib/design/tokens";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProjectWithBrandKit(id);
  if (!project) notFound();

  const brandKit = await getForProject(id);

  const initial = {
    brandKit,
    hasClientUrl: Boolean(project.clientUrl?.trim()),
    alwaysWebResearch: project.alwaysWebResearch,
  };

  return (
    <div className={`${PAGE_PADDING} flex flex-col items-center`}>
      <ProjectResearchSettings
        projectId={id}
        initialAlwaysWebResearch={project.alwaysWebResearch}
      />
      <BrandKitForm
        projectId={id}
        initial={initial}
        hasClientUrl={initial.hasClientUrl}
        hasLinkedKit={Boolean(brandKit)}
      />
    </div>
  );
}
