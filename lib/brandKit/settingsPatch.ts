import { createId } from "@paralleldrive/cuid2";
import type {
  BrandKitData,
  SettingsChangelogEntry,
  SettingsPatchItem,
} from "./types";

export type ApplySettingsPatchResult =
  | { ok: true; kit: BrandKitData; entry: SettingsChangelogEntry }
  | { ok: false; error: string };

export type RevertSettingsPatchResult =
  | { ok: true; kit: BrandKitData; entry: SettingsChangelogEntry }
  | { ok: false; error: string };

/** Deep clone via JSON for stable before/after snapshots. */
export function cloneSnapshot<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Parse slash-separated paths. Segments may contain spaces (e.g. `productNotes/Zoomlock Max`). */
export function parseSettingsPath(path: string): string[] {
  const trimmed = path.trim();
  if (!trimmed) return [];
  return trimmed.split("/").map((s) => s.trim()).filter(Boolean);
}

export function getAtPath(root: unknown, path: string): unknown {
  const segments = parseSettingsPath(path);
  let current: unknown = root;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setAtPath(root: unknown, path: string, value: unknown): void {
  const segments = parseSettingsPath(path);
  if (segments.length === 0) {
    throw new Error("Empty settings path");
  }

  let current: unknown = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const nextSegment = segments[i + 1]!;
    const nextIsIndex = /^\d+$/.test(nextSegment);

    if (current == null || typeof current !== "object") {
      throw new Error(`Cannot traverse path at segment "${segment}"`);
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid array index "${segment}"`);
      }
      while (current.length <= index) current.push(nextIsIndex ? [] : {});
      if (current[index] == null) {
        current[index] = nextIsIndex ? [] : {};
      }
      current = current[index];
      continue;
    }

    const record = current as Record<string, unknown>;
    if (!(segment in record) || record[segment] == null) {
      record[segment] = nextIsIndex ? [] : {};
    } else if (typeof record[segment] !== "object") {
      throw new Error(`Cannot traverse into scalar at "${segment}"`);
    }
    current = record[segment];
  }

  const last = segments[segments.length - 1]!;
  if (current == null || typeof current !== "object") {
    throw new Error(`Cannot set path terminal "${last}"`);
  }

  if (Array.isArray(current)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid array index "${last}"`);
    }
    while (current.length <= index) current.push(undefined);
    current[index] = value;
    return;
  }

  (current as Record<string, unknown>)[last] = value;
}

function validatePatchPath(path: string): string | null {
  if (!path.trim()) return "Patch path is required";
  const segments = parseSettingsPath(path);
  if (segments.length === 0) return "Patch path is empty";
  return null;
}

export function applySettingsPatches(
  kit: BrandKitData,
  patches: SettingsPatchItem[],
  meta: { summary: string; source: "agent" | "user" }
): ApplySettingsPatchResult {
  if (!patches.length) {
    return { ok: false, error: "At least one patch is required" };
  }
  if (!meta.summary.trim()) {
    return { ok: false, error: "Changelog summary is required" };
  }

  for (const patch of patches) {
    const pathError = validatePatchPath(patch.path);
    if (pathError) return { ok: false, error: pathError };
  }

  const nextKit = cloneSnapshot(kit);
  const recordedPatches: SettingsChangelogEntry["patches"] = [];

  for (const patch of patches) {
    const before = cloneSnapshot(getAtPath(nextKit, patch.path));
    const after = cloneSnapshot(patch.value);

    try {
      setAtPath(nextKit, patch.path, after);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to apply patch",
      };
    }

    recordedPatches.push({
      path: patch.path,
      before,
      after,
    });
  }

  const entry: SettingsChangelogEntry = {
    id: createId(),
    at: new Date().toISOString(),
    source: meta.source,
    summary: meta.summary.trim(),
    patches: recordedPatches,
  };

  nextKit.settingsChangelog = [...(nextKit.settingsChangelog ?? []), entry];

  return { ok: true, kit: nextKit, entry };
}

export function revertChangelogEntry(
  kit: BrandKitData,
  entryId: string
): RevertSettingsPatchResult {
  const changelog = kit.settingsChangelog ?? [];
  const index = changelog.findIndex((e) => e.id === entryId);
  if (index === -1) {
    return { ok: false, error: "Changelog entry not found" };
  }

  const entry = changelog[index]!;
  if (entry.revertedAt) {
    return { ok: false, error: "Changelog entry already reverted" };
  }

  const nextKit = cloneSnapshot(kit);

  // Apply in reverse order so dependent paths restore correctly.
  for (let i = entry.patches.length - 1; i >= 0; i--) {
    const patch = entry.patches[i]!;
    try {
      setAtPath(nextKit, patch.path, cloneSnapshot(patch.before));
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to revert patch",
      };
    }
  }

  const revertedAt = new Date().toISOString();
  nextKit.settingsChangelog = changelog.map((e, i) =>
    i === index ? { ...e, revertedAt } : e
  );

  return {
    ok: true,
    kit: nextKit,
    entry: { ...entry, revertedAt },
  };
}

/** Compare JSON snapshots for E2E proof — affected paths only. */
export function snapshotsEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function extractPathsSnapshot(kit: BrandKitData, paths: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    out[path] = cloneSnapshot(getAtPath(kit, path));
  }
  return out;
}
