import { formatCaptionCorpusForPrompt, hashtagGuidanceFromCorpus } from "@/lib/content/captionCorpus";

export const CAPTION_WRITER_SYSTEM_PROMPT = `You write Facebook post captions. Open with a hook, lead with customer benefit, include a light CTA, and end with hashtags.
Do NOT describe the product image or what the photo shows — the graphic handles that.
Do NOT invent product specs or features not stated in the product info or client detail.
Lead with who it's for, the problem solved, and why customers care.`;

export { formatCaptionCorpusForPrompt, hashtagGuidanceFromCorpus };
