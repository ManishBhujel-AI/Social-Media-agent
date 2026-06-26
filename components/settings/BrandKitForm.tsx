"use client";

import { useCallback, useEffect, useState } from "react";
import { GLASS_CARD } from "@/lib/design/tokens";
import type { BrandColor, BrandKitData, BrandKitFieldName, FieldSource } from "@/lib/brandKit/types";

type BrandKitResponse = {
  brandKit: {
    id: string;
    domain: string;
    website: string | null;
    kit: BrandKitData;
    missingFields: BrandKitFieldName[];
    complete: boolean;
  } | null;
  hasClientUrl: boolean;
};

const SOURCE_LABELS: Record<FieldSource, string> = {
  site: "From site",
  user: "You",
  default: "Default",
};

const FIELD_LABELS: Record<string, string> = {
  businessName: "Business name",
  website: "Website",
  businessType: "Business type",
  location: "Location",
  audience: "Audience",
  tone: "Tone",
  heritage: "Heritage",
  themeWords: "Theme words",
  contact: "Contact",
  contactStyle: "Contact style",
  aspectRatio: "Aspect ratio",
  businessSummary: "Business summary",
  colors: "Brand colors",
  avoidColors: "Colors to avoid",
};

function SourceBadge({ source }: { source?: FieldSource }) {
  if (!source) return null;
  return (
    <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
      {SOURCE_LABELS[source]}
    </span>
  );
}

function emptyKit(): BrandKitData {
  return {
    businessName: "",
    website: "",
    location: "",
    businessType: "",
    audience: "",
    tone: "",
    heritage: "",
    themeWords: "",
    contact: "",
    contactStyle: "clearly visible, on-brand color",
    aspectRatio: "1:1",
    businessSummary: "",
    colors: [],
    avoidColors: [],
    sources: { contactStyle: "default", aspectRatio: "default" },
    skipped: {},
  };
}

export function BrandKitForm({
  projectId,
  initial,
  hasClientUrl,
  hasLinkedKit,
}: {
  projectId: string;
  initial: BrandKitResponse | null;
  hasClientUrl: boolean;
  hasLinkedKit: boolean;
}) {
  const [kit, setKit] = useState<BrandKitData>(initial?.brandKit?.kit ?? emptyKit());
  const [domain, setDomain] = useState(initial?.brandKit?.domain ?? "");
  const [website, setWebsite] = useState(initial?.brandKit?.website ?? "");
  const [missingFields, setMissingFields] = useState<BrandKitFieldName[]>(
    initial?.brandKit?.missingFields ?? []
  );
  const [complete, setComplete] = useState(initial?.brandKit?.complete ?? false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial?.brandKit) {
      setKit(initial.brandKit.kit);
      setDomain(initial.brandKit.domain);
      setWebsite(initial.brandKit.website ?? "");
      setMissingFields(initial.brandKit.missingFields);
      setComplete(initial.brandKit.complete);
    }
  }, [initial]);

  const updateScalar = (field: keyof BrandKitData, value: string) => {
    setKit((prev) => ({ ...prev, [field]: value }));
  };

  const updateColor = (index: number, patch: Partial<BrandColor>) => {
    setKit((prev) => {
      const colors = [...prev.colors];
      colors[index] = { ...colors[index], ...patch };
      return { ...prev, colors };
    });
  };

  const addColor = () => {
    setKit((prev) => ({ ...prev, colors: [...prev.colors, { name: "" }] }));
  };

  const removeColor = (index: number) => {
    setKit((prev) => ({ ...prev, colors: prev.colors.filter((_, i) => i !== index) }));
  };

  const addAvoidColor = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setKit((prev) =>
      prev.avoidColors.includes(trimmed)
        ? prev
        : { ...prev, avoidColors: [...prev.avoidColors, trimmed] }
    );
  };

  const removeAvoidColor = (index: number) => {
    setKit((prev) => ({
      ...prev,
      avoidColors: prev.avoidColors.filter((_, i) => i !== index),
    }));
  };

  const save = useCallback(async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kit),
      });
      const data = (await res.json()) as BrandKitResponse & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not save");
        return;
      }
      if (data.brandKit) {
        setKit(data.brandKit.kit);
        setDomain(data.brandKit.domain);
        setWebsite(data.brandKit.website ?? "");
        setMissingFields(data.brandKit.missingFields);
        setComplete(data.brandKit.complete);
      }
      setMessage("Brand kit saved.");
    } catch {
      setError("Could not save brand kit.");
    } finally {
      setSaving(false);
    }
  }, [projectId, kit]);

  const inputClass =
    "w-full px-3 py-2 rounded-xl text-sm bg-white/80 border border-white/90 outline-none focus:border-violet-400/50";

  return (
    <div className={`${GLASS_CARD} max-w-3xl p-6 flex flex-col gap-6`}>
      <div>
        <h2 className="text-lg font-bold text-slate-800">Brand kit</h2>
        <p className="text-sm text-slate-500 mt-1">
          {hasLinkedKit
            ? complete
              ? "Brand setup complete. Edit details here anytime — changes apply to future graphics and captions."
              : "Brand setup in progress. Fill missing fields below or answer the setup cards in chat."
            : "No brand kit yet — provide a website in chat to extract one, or fill in the fields below and save."}
        </p>
      </div>

      {(domain || website) && (
        <div className="flex flex-wrap gap-4 text-sm text-slate-600 px-1">
          {domain && (
            <div>
              <span className="text-slate-400 text-xs uppercase tracking-wide">Domain</span>
              <div className="font-medium">{domain}</div>
            </div>
          )}
          {website && (
            <div>
              <span className="text-slate-400 text-xs uppercase tracking-wide">Website</span>
              <div className="font-medium">{website}</div>
            </div>
          )}
        </div>
      )}

      {hasLinkedKit && (
        <div
          className={`text-sm px-3 py-2 rounded-xl border ${
            complete
              ? "bg-green-500/8 border-green-400/30 text-green-800"
              : "bg-amber-500/8 border-amber-400/30 text-amber-900"
          }`}
        >
          {complete
            ? "Brand kit is complete for planning."
            : `Missing for planning: ${missingFields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}`}
          {hasClientUrl && !kit.website.trim() && (
            <span className="block mt-1 text-xs opacity-80">Website is required while this brief has a client URL.</span>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">{FIELD_LABELS.businessSummary}</span>
          <SourceBadge source={kit.sources.businessSummary} />
        </div>
        <textarea
          className={`${inputClass} min-h-[120px] resize-y leading-relaxed`}
          value={kit.businessSummary}
          onChange={(e) => updateScalar("businessSummary", e.target.value)}
          placeholder="2–3 paragraphs covering: who their customers are, what they sell, locations served, differentiators, brand voice, and heritage."
        />
        <p className="text-[11px] text-slate-400">
          Generated during brand setup from the website (~200–350 words). Edit anytime — future posts use this for on-brand captions and graphics. Refresh this page to auto-expand a short summary.
        </p>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(
          [
            "businessName",
            "businessType",
            "location",
            "audience",
            "tone",
            "contact",
            "heritage",
            "themeWords",
            "website",
            "contactStyle",
            "aspectRatio",
          ] as const
        ).map((field) => (
          <label key={field} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-600">{FIELD_LABELS[field]}</span>
              <SourceBadge source={kit.sources[field]} />
            </div>
            <input
              type="text"
              className={inputClass}
              value={kit[field]}
              onChange={(e) => updateScalar(field, e.target.value)}
              placeholder={FIELD_LABELS[field]}
            />
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-600">{FIELD_LABELS.colors}</div>
            <SourceBadge source={kit.sources.colors} />
          </div>
          <button
            type="button"
            onClick={addColor}
            className="text-xs font-semibold text-violet-600 hover:text-violet-800"
          >
            + Add color
          </button>
        </div>
        {kit.colors.length === 0 && (
          <p className="text-xs text-slate-400">No colors yet — add primary, secondary, accent.</p>
        )}
        <div className="flex flex-col gap-2">
          {kit.colors.map((color, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                className={`${inputClass} flex-1`}
                placeholder="Name (e.g. navy blue)"
                value={color.name}
                onChange={(e) => updateColor(i, { name: e.target.value })}
              />
              <input
                type="text"
                className={`${inputClass} w-28`}
                placeholder="#hex"
                value={color.hex ?? ""}
                onChange={(e) => updateColor(i, { hex: e.target.value || undefined })}
              />
              <button
                type="button"
                onClick={() => removeColor(i)}
                className="text-slate-400 hover:text-red-500 px-2"
                aria-label="Remove color"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <AvoidColorsInput
        values={kit.avoidColors}
        source={kit.sources.avoidColors}
        onAdd={addAvoidColor}
        onRemove={removeAvoidColor}
      />

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-500 hover:from-violet-700 hover:to-indigo-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save brand kit"}
        </button>
        {message && <span className="text-sm text-green-700">{message}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

function AvoidColorsInput({
  values,
  source,
  onAdd,
  onRemove,
}: {
  values: string[];
  source?: FieldSource;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold text-slate-600">{FIELD_LABELS.avoidColors}</div>
          <SourceBadge source={source} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {values.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-200/80 text-slate-700"
          >
            {c}
            <button type="button" onClick={() => onRemove(i)} className="text-slate-500 hover:text-red-500">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 px-3 py-2 rounded-xl text-sm bg-white/80 border border-white/90 outline-none focus:border-violet-400/50"
          placeholder="Add color to avoid (e.g. yellow)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd(draft);
              setDraft("");
            }
          }}
        />
        <button
          type="button"
          onClick={() => {
            onAdd(draft);
            setDraft("");
          }}
          className="px-3 py-2 rounded-xl text-xs font-semibold text-violet-600 border border-violet-300/50 hover:bg-violet-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
