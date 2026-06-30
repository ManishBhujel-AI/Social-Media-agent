import { getForProject, getProjectWithBrandKit } from "@/lib/brandKit/store";
import { BrandKitForm } from "@/components/settings/BrandKitForm";
import { CaptionCorpusPanel } from "@/components/settings/CaptionCorpusPanel";
import { SettingsWriteLoopHarness } from "@/components/settings/SettingsWriteLoopHarness";
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
  };

  return (
    <div className={`${PAGE_PADDING} flex flex-col items-center`}>
      <SettingsWriteLoopHarness projectId={id} />
      <CaptionCorpusPanel projectId={id} />
      <BrandKitForm
        projectId={id}
        initial={initial}
        hasClientUrl={initial.hasClientUrl}
        hasLinkedKit={Boolean(brandKit)}
      />
    </div>
  );
}
