import type { ContentReference } from "@/lib/content/references";

export const CAPTION_WRITER_SYSTEM_PROMPT = `You write Facebook post captions. Open with a hook, lead with customer benefit, include a light CTA, and end with hashtags.
Match brand tone. When a client-approved caption example is provided, align closely with its voice, structure, hooks, factual claims, CTA style, and hashtag count/mix.
Do NOT describe the product image or what the photo shows — the graphic handles that.
Do NOT invent product specs or features not stated in the marketing brief or references.
Lead with who it's for, the problem solved, and why customers care.`;

/** Derive hashtag guidance from saved caption examples, or use a sensible default. */
export function hashtagGuidanceFromReferences(refs: ContentReference[]): string {
  const exampleTexts = refs
    .filter((r) => r.kind === "caption_example" && r.text?.includes("#"))
    .map((r) => r.text!);

  if (exampleTexts.length) {
    const counts = exampleTexts.map((text) => (text.match(/#[\w]+/g) ?? []).length);
    const target = Math.max(...counts);
    return `Hashtags: use about ${target} relevant tags at the end — match the client's approved example mix (branded, local, and service-category).`;
  }

  return "Hashtags: end with 4–6 relevant tags — include branded, local/location, and service-category tags.";
}
