import type { ImageEditOptions, ImageGenerateOptions, ImageProvider } from "./imageProvider.types";
import { OpenRouterImageProvider } from "./providers/openRouterImageProvider";

let provider: ImageProvider | null = null;

export type { ImageGenerateOptions, ImageEditOptions, ImageProvider } from "./imageProvider.types";

export function getImageProvider(): ImageProvider {
  if (!provider) {
    provider = new OpenRouterImageProvider();
  }
  return provider;
}

export function setImageProvider(p: ImageProvider) {
  provider = p;
}
