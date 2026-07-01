// Slugs verified against OpenRouter Models API on 2026-06-30.
// Re-check before changing: curl https://openrouter.ai/api/v1/images/models
export const MODELS = {
  chatAgent: { model: "google/gemini-2.5-pro" },
  vision: { model: "google/gemini-2.5-flash" },
  caption: { model: "openai/gpt-5.5" },
  promptRefiner: { model: "openai/gpt-5.5" },
  image: { model: "openai/gpt-image-2" },
  imageFeedback: { model: "openai/gpt-image-2" },
  research: { model: "perplexity/sonar" },
} as const;
