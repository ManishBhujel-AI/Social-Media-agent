import { productNamesMatch } from "@/lib/content/splitCaptionExamples";
import type { BrandKitData, ClientPreferenceEntry } from "./types";

export type PreferenceContext = {
  product?: string;
  topic?: string;
};

export function normalizeScopeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePreferenceScope(
  scope: string
): { kind: "client" } | { kind: "product"; name: string } | { kind: "topic"; name: string } | null {
  if (scope === "client") return { kind: "client" };
  if (scope.startsWith("product:")) {
    const name = scope.slice("product:".length).trim();
    return name ? { kind: "product", name } : null;
  }
  if (scope.startsWith("topic:")) {
    const name = scope.slice("topic:".length).trim();
    return name ? { kind: "topic", name } : null;
  }
  return null;
}

/** Returns matching scope names only when exactly one confident match exists. */
function findConfidentScopedNames(
  scopeNames: string[],
  label: string | undefined
): string[] | null {
  if (!label?.trim()) return null;

  const matches = scopeNames.filter((name) => productNamesMatch(name, label));
  if (matches.length === 0) return null;

  const normalized = new Set(matches.map(normalizeScopeName));
  if (normalized.size !== 1) return null;

  return matches;
}

export function findConfidentProductNoteKey(
  productNotes: Record<string, string>,
  productName: string | undefined
): string | null {
  if (!productName?.trim()) return null;
  const keys = Object.keys(productNotes);
  const matches = findConfidentScopedNames(keys, productName);
  if (!matches || matches.length === 0) return null;
  return matches[0]!;
}

function filterPreferencesForContext(
  entries: ClientPreferenceEntry[],
  context: PreferenceContext
): ClientPreferenceEntry[] {
  const clientEntries = entries.filter((e) => e.scope === "client");

  const productScoped = entries.filter((e) => parsePreferenceScope(e.scope)?.kind === "product");
  const productScopeNames = Array.from(
    new Set(
      productScoped
        .map((e) => parsePreferenceScope(e.scope))
        .filter((p): p is { kind: "product"; name: string } => p?.kind === "product")
        .map((p) => p.name)
    )
  );
  const confidentProductScopes = findConfidentScopedNames(productScopeNames, context.product);

  const topicScoped = entries.filter((e) => parsePreferenceScope(e.scope)?.kind === "topic");
  const topicScopeNames = Array.from(
    new Set(
      topicScoped
        .map((e) => parsePreferenceScope(e.scope))
        .filter((p): p is { kind: "topic"; name: string } => p?.kind === "topic")
        .map((p) => p.name)
    )
  );
  const confidentTopicScopes = findConfidentScopedNames(topicScopeNames, context.topic);

  const productEntries =
    confidentProductScopes && confidentProductScopes.length === 1
      ? productScoped.filter((e) => {
          const parsed = parsePreferenceScope(e.scope);
          return (
            parsed?.kind === "product" &&
            confidentProductScopes.some((name) => productNamesMatch(name, parsed.name))
          );
        })
      : [];

  const topicEntries =
    confidentTopicScopes && confidentTopicScopes.length === 1
      ? topicScoped.filter((e) => {
          const parsed = parsePreferenceScope(e.scope);
          return (
            parsed?.kind === "topic" &&
            confidentTopicScopes.some((name) => productNamesMatch(name, parsed.name))
          );
        })
      : [];

  return [...clientEntries, ...productEntries, ...topicEntries];
}

export function formatPreferencesForPrompt(
  kit: BrandKitData,
  context: PreferenceContext = {}
): string {
  const entries = kit.clientPreferences ?? [];
  if (entries.length === 0) return "";

  const filtered = filterPreferencesForContext(entries, context);
  if (filtered.length === 0) return "";

  const lines = filtered.map((e) => `- [${e.scope}] ${e.note}`);
  return `CLIENT PREFERENCES (must follow):\n${lines.join("\n")}`;
}

export function formatProductNotesForPrompt(
  kit: BrandKitData,
  productName: string | undefined
): string {
  const notes = kit.productNotes ?? {};
  const key = findConfidentProductNoteKey(notes, productName);
  if (!key) return "";
  const note = notes[key]?.trim();
  if (!note) return "";
  return `PRODUCT NOTES for ${key}:\n${note}`;
}

export function formatSecondaryContactsForCaption(kit: BrandKitData): string {
  const contacts = kit.secondaryContacts ?? [];
  if (contacts.length === 0) return "";

  const lines = contacts.map((c) => {
    const parts = [c.branch, c.phone, c.address].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });
  return `BRANCH CONTACTS (use in captions when multi-location detail is needed):\n${lines.join("\n")}`;
}

export function resolvePreferenceContextFromTask(task: {
  subject: string;
  title: string;
  productInfo?: unknown;
}): PreferenceContext {
  const info =
    task.productInfo && typeof task.productInfo === "object"
      ? (task.productInfo as { name?: string })
      : null;
  const product = info?.name?.trim() || task.subject?.trim() || task.title?.trim() || undefined;
  return { product };
}
