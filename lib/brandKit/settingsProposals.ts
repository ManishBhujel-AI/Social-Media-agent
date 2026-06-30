import { createId } from "@paralleldrive/cuid2";
import { prisma } from "@/lib/db/prisma";
import { emitMessageCreated } from "@/lib/chat/messageEvents";
import { getForProject } from "./store";
import type {
  BrandKitData,
  ClientPreferenceEntry,
  ClientPreferenceScope,
  SettingsPatchItem,
} from "./types";

export type SettingsProposalMeta = {
  type: "settings_proposal";
  status: "pending" | "applied" | "declined";
  proposal: {
    summary: string;
    patches: SettingsPatchItem[];
    source: "agent" | "user";
  };
  changelogEntryId?: string;
};

function isValidPatch(patch: unknown): patch is SettingsPatchItem {
  if (!patch || typeof patch !== "object") return false;
  const p = patch as { path?: unknown; value?: unknown };
  return typeof p.path === "string" && p.path.trim().length > 0;
}

export function parseProposalPatches(raw: unknown): SettingsPatchItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const patches: SettingsPatchItem[] = [];
  for (const item of raw) {
    if (!isValidPatch(item)) return null;
    patches.push({ path: item.path.trim(), value: item.value });
  }
  return patches;
}

export async function postSettingsProposal(params: {
  projectId: string;
  conversationId: string;
  summary: string;
  patches: SettingsPatchItem[];
  source?: "agent" | "user";
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const summary = params.summary.trim();
  if (!summary) return { ok: false, error: "Proposal summary is required" };
  if (!params.patches.length) return { ok: false, error: "At least one patch is required" };

  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: "assistant",
      content: summary,
      meta: {
        type: "settings_proposal",
        status: "pending",
        proposal: {
          summary,
          patches: params.patches,
          source: params.source ?? "agent",
        },
      } as object,
    },
  });

  await emitMessageCreated(params.projectId, message);
  return { ok: true, messageId: message.id };
}

export async function buildPreferenceAppendPatch(
  projectId: string,
  entry: Omit<ClientPreferenceEntry, "id" | "date">
): Promise<SettingsPatchItem[] | { error: string }> {
  const view = await getForProject(projectId);
  if (!view) return { error: "Brand kit not found" };

  const existing = view.kit.clientPreferences ?? [];
  const newEntry: ClientPreferenceEntry = {
    id: createId(),
    date: new Date().toISOString().slice(0, 10),
    scope: entry.scope,
    note: entry.note.trim(),
  };

  if (!newEntry.note) return { error: "Preference note is required" };

  return [
    {
      path: "clientPreferences",
      value: [...existing, newEntry],
    },
  ];
}

export async function buildProductNotePatch(
  projectId: string,
  product: string,
  note: string
): Promise<SettingsPatchItem[] | { error: string }> {
  const productName = product.trim();
  const trimmedNote = note.trim();
  if (!productName) return { error: "Product name is required" };
  if (!trimmedNote) return { error: "Product note is required" };

  const view = await getForProject(projectId);
  if (!view) return { error: "Brand kit not found" };

  return [
    {
      path: `productNotes/${productName}`,
      value: trimmedNote,
    },
  ];
}

export async function buildScalarFieldPatch(
  projectId: string,
  field: keyof BrandKitData,
  value: unknown
): Promise<SettingsPatchItem[] | { error: string }> {
  if (typeof field !== "string" || !field.trim()) {
    return { error: "Field name is required" };
  }
  const view = await getForProject(projectId);
  if (!view) return { error: "Brand kit not found" };

  return [{ path: field, value }];
}

export function parsePreferenceScope(raw: unknown): ClientPreferenceScope | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const scope = raw.trim();
  if (scope === "client") return "client";
  if (scope.startsWith("product:") && scope.length > "product:".length) {
    return scope as ClientPreferenceScope;
  }
  if (scope.startsWith("topic:") && scope.length > "topic:".length) {
    return scope as ClientPreferenceScope;
  }
  return null;
}
