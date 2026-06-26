import { MAX_IMAGE_REFS } from "./imageRefs.config";

export type ReferenceRole = "product" | "extra" | "logo" | "style";

export type ResolvedReference = {
  dataUrl: string;
  role: ReferenceRole;
};

/** Ordered blob URLs: primary product, extra sourceImages (deduped), project logo. */
export function buildReferenceUrlList(params: {
  productImageUrl: string | null;
  sourceImages: string[];
  logoUrl: string | null;
  styleImageUrls?: string[];
}): { url: string; role: ReferenceRole }[] {
  const { productImageUrl, sourceImages, logoUrl, styleImageUrls = [] } = params;
  const entries: { url: string; role: ReferenceRole }[] = [];
  const seen = new Set<string>();

  const push = (url: string | null | undefined, role: ReferenceRole) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    entries.push({ url, role });
  };

  let primary = productImageUrl;
  let extras = sourceImages;

  if (!primary && sourceImages.length > 0) {
    primary = sourceImages[0];
    extras = sourceImages.slice(1);
  } else if (primary) {
    extras = sourceImages.filter((url) => url !== primary);
  }

  push(primary, "product");
  for (const url of extras) push(url, "extra");
  for (const url of styleImageUrls.slice(0, 1)) push(url, "style");
  push(logoUrl, "logo");

  return entries;
}

/** Cap refs while preferring product first and logo last when present. */
export function capReferenceEntries(
  entries: { url: string; role: ReferenceRole }[],
  max: number,
  opts?: { reserveLogo?: boolean }
): { url: string; role: ReferenceRole }[] {
  if (max <= 0) return [];
  if (entries.length <= max) return entries;

  const logo = entries.find((e) => e.role === "logo");
  const reserveLogo = opts?.reserveLogo && Boolean(logo);
  const nonLogo = entries.filter((e) => e.role !== "logo");

  const product = nonLogo.find((e) => e.role === "product");
  const style = nonLogo.find((e) => e.role === "style");
  const extras = nonLogo.filter((e) => e.role === "extra");

  const capped: { url: string; role: ReferenceRole }[] = [];
  if (product) capped.push(product);
  if (style && capped.length < max - (reserveLogo ? 1 : logo ? 1 : 0)) {
    capped.push(style);
  }

  const slotsForExtras = Math.max(
    0,
    max - capped.length - (reserveLogo ? 1 : logo ? 1 : 0)
  );
  capped.push(...extras.slice(0, slotsForExtras));

  if (reserveLogo && logo) {
    capped.push(logo);
  } else if (!reserveLogo && logo && capped.length < max) {
    capped.push(logo);
  }

  return capped.slice(0, max);
}

export function labelReferenceImages(refs: ResolvedReference[]): string {
  if (!refs.length) return "";

  const product = refs.find((r) => r.role === "product");
  const logo = refs.find((r) => r.role === "logo");
  const extras = refs.filter((r) => r.role === "extra");

  if (product && logo && !extras.length) {
    return "\nReference images: Image 1 = product photo; Image 2 = brand logo.";
  }

  const lines = refs.map((ref, i) => {
    const n = i + 1;
    if (ref.role === "product") return `Image ${n} = product photo`;
    if (ref.role === "logo") return `Image ${n} = brand logo`;
    if (ref.role === "style") return `Image ${n} = style inspiration (layout/mood only)`;
    if (ref.role === "extra") return `Image ${n} = additional product photo`;
    return `Image ${n} = additional reference`;
  });

  return `\nReference images: ${lines.join("; ")}.`;
}

export function buildReferencePromptSuffix(
  refs: ResolvedReference[],
  opts: { logoOmitted?: boolean; hadLogo?: boolean }
): string {
  if (!refs.length) {
    if (opts.hadLogo) {
      return "\nNo reference images available — use clean typography for the business name instead of a logo.";
    }
    return "";
  }

  let suffix = labelReferenceImages(refs);

  const hasProduct = refs.some((r) => r.role === "product");
  const hasLogo = refs.some((r) => r.role === "logo");
  const productPhotoCount = refs.filter((r) => r.role === "product" || r.role === "extra").length;

  if (hasProduct) {
    suffix +=
      "\n- Use the attached product photo(s) EXACTLY as provided — do NOT recolor, age, dirty, stylize, or alter the product in any way. Build the design around them.";
  }
  if (productPhotoCount > 1) {
    const productLabels = refs
      .map((ref, i) => ({ ref, n: i + 1 }))
      .filter(({ ref }) => ref.role === "product" || ref.role === "extra")
      .map(({ n }) => `Image ${n}`)
      .join(", ");
    suffix += `\n- The user uploaded ${productPhotoCount} product photos (${productLabels}). Include ALL of them in the final graphic — each shot must be clearly visible (e.g. collage, split layout, or multi-angle composition). Do not omit any uploaded product photo.`;
  }
  if (hasLogo) {
    suffix +=
      "\n- Use the attached brand logo EXACTLY as provided — do NOT redraw, restyle, or re-letter it. Place it tastefully where it fits the composition, clearly visible, and never cropped.";
  }
  const hasStyle = refs.some((r) => r.role === "style");
  if (hasStyle) {
    suffix +=
      "\n- Style reference image is for layout and mood inspiration only — create an original composition; do not clone or reproduce third-party logos/text.";
  } else if (opts.logoOmitted && opts.hadLogo) {
    suffix +=
      "\nInclude the client brand logo tastefully in the layout (logo could not be attached as a reference).";
  } else if (!opts.hadLogo) {
    suffix += "\nNo brand logo available — use clean typography for the business name instead.";
  }

  return suffix;
}

export function getMaxImageRefs(): number {
  return MAX_IMAGE_REFS;
}
