// Slugs verified against OpenRouter Models API on 2026-06-18.
// Re-check before changing: curl https://openrouter.ai/api/v1/models
export const MODELS = {
  chatAgent: { model: "google/gemini-2.5-pro" },
  vision: { model: "google/gemini-2.5-flash" },
  caption: { model: "openai/gpt-4o-mini" },
  promptRefiner: { model: "openai/gpt-4o-mini" },
  // Nano Banana 2 — v1 (gemini-2.5-flash-image) failed the edit-fidelity smoke test on 2026-06-18
  // (edits did not apply). Using GA model for usable instructed edits.
  image: { model: "google/gemini-3.1-flash-image" },
  research: { model: "perplexity/sonar" },
} as const;

// Cheaper alternate (rejected): "google/gemini-2.5-flash-image" — Nano Banana v1, too timid on edits
