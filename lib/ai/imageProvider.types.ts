export interface ImageGenerateOptions {
  prompt: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  aspectRatio?: string;
  model?: string;
}

export interface ImageEditOptions {
  originalImageUrl: string;
  instruction: string;
  referenceImageUrls?: string[];
  model?: string;
}

export interface ImageProvider {
  generate(opts: ImageGenerateOptions): Promise<Buffer>;
  edit(opts: ImageEditOptions): Promise<Buffer>;
}
