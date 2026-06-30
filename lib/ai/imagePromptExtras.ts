import type { Task } from "@prisma/client";
import type { ProductSummary } from "./productContext";
import { formatUserProductNotesForPrompt, formatVisualContextForPrompt } from "./productContext";
import { formatReferencesForGraphicPrompt, type ContentReference } from "@/lib/content/references";

export function appendImagePromptExtras(params: {
  task: Pick<Task, "sourceImages" | "userProductNotes">;
  visualContext?: ProductSummary["visualContext"];
  styleRefs: ContentReference[];
}): string {
  const parts: string[] = [];
  const visualNote = formatVisualContextForPrompt(params.visualContext);
  const notesBlock = formatUserProductNotesForPrompt(params.task.userProductNotes);
  const styleBlock = formatReferencesForGraphicPrompt(params.styleRefs);

  const sourceImageCount = ((params.task.sourceImages as string[] | null) ?? []).length;
  if (sourceImageCount > 0) {
    parts.push(
      sourceImageCount > 1
        ? `User provided ${sourceImageCount} product photos. The graphic must visibly include all ${sourceImageCount} uploaded product shots in the composition.`
        : "User provided a product photo. The graphic must feature that exact uploaded product photo prominently — do not replace it with an AI-generated product."
    );
  }

  if (visualNote) parts.push(visualNote);
  if (notesBlock) parts.push(notesBlock);
  if (styleBlock) parts.push(styleBlock);

  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}
