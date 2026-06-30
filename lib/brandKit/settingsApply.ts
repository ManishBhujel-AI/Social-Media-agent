import { saveKitForProject, getForProject, ensureProjectScopedKit } from "./store";
import {
  applySettingsPatches,
  revertChangelogEntry,
  type ApplySettingsPatchResult,
  type RevertSettingsPatchResult,
} from "./settingsPatch";
import { normalizeBrandKitData, type SettingsPatchItem } from "./types";

export async function applyProjectSettingsPatches(
  projectId: string,
  patches: SettingsPatchItem[],
  meta: { summary: string; source: "agent" | "user" }
): Promise<ApplySettingsPatchResult & { brandKitId?: string }> {
  const view = (await getForProject(projectId)) ?? (await ensureProjectScopedKit(projectId));
  const kit = normalizeBrandKitData(view.kit);

  const result = applySettingsPatches(kit, patches, meta);
  if (!result.ok) return result;

  const saved = await saveKitForProject(projectId, result.kit);
  return { ...result, brandKitId: saved.id };
}

export async function revertProjectChangelogEntry(
  projectId: string,
  entryId: string
): Promise<RevertSettingsPatchResult & { brandKitId?: string }> {
  const view = await getForProject(projectId);
  if (!view) {
    return { ok: false, error: "Brand kit not found" };
  }

  const kit = normalizeBrandKitData(view.kit);
  const result = revertChangelogEntry(kit, entryId);
  if (!result.ok) return result;

  const saved = await saveKitForProject(projectId, result.kit);
  return { ...result, brandKitId: saved.id };
}
