import { MODELS } from "../models.config";
import { RetryableError } from "../errors";
import type { ImageEditOptions, ImageGenerateOptions, ImageProvider } from "../imageProvider.types";

type OpenRouterImagesResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

function parseImageResponse(data: OpenRouterImagesResponse): Buffer {
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    console.error("No images in OpenRouter response:", JSON.stringify(data, null, 2).slice(0, 2000));
    throw new RetryableError("No image data in OpenRouter response");
  }
  return Buffer.from(b64, "base64");
}

export class OpenRouterImageProvider implements ImageProvider {
  private async call(body: Record<string, unknown>): Promise<Buffer> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

    const res = await fetch("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Brewline Content Studio",
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new RetryableError(`OpenRouter image error ${res.status}: ${rawText}`);
    }

    let data: OpenRouterImagesResponse;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse OpenRouter image response:", rawText.slice(0, 500));
      throw new RetryableError("Invalid JSON from OpenRouter image API");
    }

    if (data.error?.message) {
      throw new RetryableError(`OpenRouter image error: ${data.error.message}`);
    }

    return parseImageResponse(data);
  }

  async generate(opts: ImageGenerateOptions): Promise<Buffer> {
    const model = opts.model ?? MODELS.image.model;
    const refs = opts.referenceImageUrls?.length
      ? opts.referenceImageUrls
      : opts.referenceImageUrl
        ? [opts.referenceImageUrl]
        : [];

    return this.call({
      model,
      prompt: opts.prompt,
      aspect_ratio: opts.aspectRatio ?? "1:1",
      output_format: "png",
      ...(refs.length
        ? {
            input_references: refs.map((url) => ({
              type: "image_url",
              image_url: { url },
            })),
          }
        : {}),
    });
  }

  async edit(opts: ImageEditOptions): Promise<Buffer> {
    const model = opts.model ?? MODELS.image.model;
    const refs = [opts.originalImageUrl, ...(opts.referenceImageUrls ?? [])];
    const instruction = `${opts.instruction}\n\nThe first reference image is the current graphic.${
      opts.referenceImageUrls?.length
        ? " Additional image(s) are user-provided references — incorporate them only as described in the instruction."
        : ""
    }\n\nChange ONLY what is described above. Preserve everything else identically.`;

    return this.call({
      model,
      prompt: instruction,
      aspect_ratio: "1:1",
      output_format: "png",
      input_references: refs.map((url) => ({
        type: "image_url",
        image_url: { url },
      })),
    });
  }
}
