import { MODELS } from "../models.config";
import { RetryableError } from "../errors";
import type { ImageEditOptions, ImageGenerateOptions, ImageProvider } from "../imageProvider.types";

type OpenRouterImageResponse = {
  choices?: Array<{
    message?: {
      content?: string | unknown;
      images?: Array<{ image_url?: { url?: string }; imageUrl?: { url?: string } }>;
    };
  }>;
};

function parseDataUrl(dataUrl: string): Buffer {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new RetryableError(`Invalid data URL: ${dataUrl.slice(0, 40)}...`);
  return Buffer.from(match[2], "base64");
}

export function extractImagesFromResponse(data: OpenRouterImageResponse): Buffer[] {
  const images: Buffer[] = [];
  const message = data.choices?.[0]?.message;
  if (!message) return images;

  if (Array.isArray(message.images)) {
    for (const img of message.images) {
      const url = img.image_url?.url ?? img.imageUrl?.url;
      if (url) images.push(parseDataUrl(url));
    }
  }

  if (images.length === 0 && message.content) {
    const content = message.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as { type?: string; image_url?: { url?: string }; inline_data?: { data?: string; mime_type?: string } };
        if (p.type === "image_url" && p.image_url?.url) {
          images.push(parseDataUrl(p.image_url.url));
        }
        if (p.inline_data?.data) {
          images.push(Buffer.from(p.inline_data.data, "base64"));
        }
      }
    }
  }

  return images;
}

export class OpenRouterImageProvider implements ImageProvider {
  private async call(
    model: string,
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
  ): Promise<Buffer> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        "X-Title": "Brewline Content Studio",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
        image_config: { aspect_ratio: "1:1" },
      }),
    });

    const rawText = await res.text();
    if (!res.ok) {
      throw new RetryableError(`OpenRouter image error ${res.status}: ${rawText}`);
    }

    let data: OpenRouterImageResponse;
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("Failed to parse OpenRouter image response:", rawText.slice(0, 500));
      throw new RetryableError("Invalid JSON from OpenRouter image API");
    }

    const images = extractImagesFromResponse(data);
    if (images.length === 0) {
      console.error("No images in OpenRouter response:", JSON.stringify(data, null, 2).slice(0, 2000));
      throw new RetryableError("No image data in OpenRouter response");
    }

    return images[0];
  }

  async generate(opts: ImageGenerateOptions): Promise<Buffer> {
    const model = opts.model ?? MODELS.image.model;
    const refs = opts.referenceImageUrls?.length
      ? opts.referenceImageUrls
      : opts.referenceImageUrl
        ? [opts.referenceImageUrl]
        : [];

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: opts.prompt },
    ];
    for (const ref of refs) {
      content.push({ type: "image_url", image_url: { url: ref } });
    }
    return this.call(model, content);
  }

  async edit(opts: ImageEditOptions): Promise<Buffer> {
    const model = opts.model ?? MODELS.image.model;
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "image_url", image_url: { url: opts.originalImageUrl } },
    ];
    for (const ref of opts.referenceImageUrls ?? []) {
      content.push({ type: "image_url", image_url: { url: ref } });
    }
    content.push({
      type: "text",
      text: `${opts.instruction}\n\nThe first image is the current graphic.${
        opts.referenceImageUrls?.length
          ? " Additional image(s) are user-provided references — incorporate them only as described in the instruction."
          : ""
      }\n\nChange ONLY what is described above. Preserve everything else identically.`,
    });
    return this.call(model, content);
  }
}
