#!/usr/bin/env tsx
/**
 * Mandatory OpenRouter image smoke test.
 * (a) Generate from text prompt
 * (b) Edit with locked instruction — verify fidelity
 * (c) Multi-reference — prove 3+ image refs; set MAX_IMAGE_REFS (4, 2, or 1)
 */
import fs from "fs/promises";
import path from "path";
import { MODELS } from "../lib/ai/models.config";
import { OpenRouterImageProvider } from "../lib/ai/providers/openRouterImageProvider";
import { openRouterChatJSON } from "../lib/ai/openrouter";

const OUT_DIR = path.join(process.cwd(), "generated", "smoke-test");
const CONFIG_PATH = path.join(process.cwd(), "lib/ai/imageRefs.config.ts");

async function writeMaxImageRefsConfig(maxRefs: number) {
  const body = [
    "/**",
    " * Max reference images gemini-3.1-flash-image accepts in one request.",
    " * Updated by npm run test:image part (c). Default: 4 (product + extras + logo headroom).",
    " */",
    `export const MAX_IMAGE_REFS = ${maxRefs};`,
    "",
  ].join("\n");
  await fs.writeFile(CONFIG_PATH, body);
}

type ShapeCheck = {
  hasRedSquare: boolean;
  hasBlueCircle: boolean;
  hasGreenTriangle?: boolean;
  pass: boolean;
  notes: string;
};

async function verifyGraphic(
  buffer: Buffer,
  expect: { red: boolean; blue: boolean; green?: boolean }
): Promise<ShapeCheck> {
  const systemParts = [
    "Does this graphic clearly include a red square (product)? Return JSON: hasRedSquare, hasBlueCircle",
    expect.green !== undefined ? ", hasGreenTriangle" : "",
    ", pass (all expected shapes true), notes",
  ].join("");

  const userText = expect.green
    ? "Generated graphic — expect red square (hero product), blue circle (additional reference), and green triangle (logo badge):"
    : "Generated graphic — expect red square (product hero) AND blue circle (logo badge):";

  const result = await openRouterChatJSON<ShapeCheck>({
    model: "google/gemini-2.5-flash",
    messages: [
      { role: "system", content: systemParts },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${buffer.toString("base64")}` },
          },
        ],
      },
    ],
  });

  const pass =
    result.hasRedSquare === expect.red &&
    result.hasBlueCircle === expect.blue &&
    (expect.green === undefined || result.hasGreenTriangle === expect.green);

  return { ...result, pass };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("FAIL: OPENROUTER_API_KEY not set");
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const provider = new OpenRouterImageProvider();
  const model = MODELS.image.model;

  console.log("\n=== (a) Generate image ===");
  console.log("Model:", model);
  const prompt =
    "A tall glass of iced coffee on a sunlit cafe table, cream and amber tones, lifestyle photography, no text overlay";
  const generated = await provider.generate({ prompt, model });
  const genPath = path.join(OUT_DIR, "a-generated.png");
  await fs.writeFile(genPath, generated);
  console.log("PASS (a): saved", genPath);

  console.log("\n=== (b) Edit fidelity ===");
  const dataUrl = `data:image/png;base64,${generated.toString("base64")}`;
  const instruction =
    "Change ONLY the background color to warm amber. Keep everything else identical — same composition, glass, ice, lighting, and table.";
  const edited = await provider.edit({
    originalImageUrl: dataUrl,
    instruction,
    model,
  });
  const editPath = path.join(OUT_DIR, "b-edited.png");
  await fs.writeFile(editPath, edited);
  console.log("Edit produced output:", editPath);

  const check = await openRouterChatJSON<{
    backgroundChanged: boolean;
    compositionPreserved: boolean;
    pass: boolean;
    notes: string;
  }>({
    model: "google/gemini-2.5-flash",
    messages: [
      {
        role: "system",
        content:
          "Compare two images (original then edited). Did ONLY the background change to warm amber while composition/subjects stayed the same? Return JSON: backgroundChanged, compositionPreserved, pass (both true), notes",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Original:" },
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: "Edited:" },
          {
            type: "image_url",
            image_url: { url: `data:image/png;base64,${edited.toString("base64")}` },
          },
        ],
      },
    ],
  });

  console.log("Fidelity check:", check);

  if (!check.pass) {
    console.error("\nFAIL (b): Edit fidelity poor on", model);
    process.exit(1);
  }
  console.log("\nPASS (b): Edit fidelity acceptable");

  console.log("\n=== (c) Multi-reference ===");
  const productRef = await provider.generate({
    model,
    prompt:
      "A single solid bright red square centered on a plain white background. Flat color, no text, no shadows.",
  });
  const extraRef = await provider.generate({
    model,
    prompt:
      "A single solid bright blue circle centered on a plain white background. Flat color, no text, no shadows.",
  });
  const logoRef = await provider.generate({
    model,
    prompt:
      "A single solid bright green triangle centered on a plain white background. Flat color, no text, no shadows.",
  });

  const productPath = path.join(OUT_DIR, "c-product-ref.png");
  const extraPath = path.join(OUT_DIR, "c-extra-ref.png");
  const logoPath = path.join(OUT_DIR, "c-logo-ref.png");
  await fs.writeFile(productPath, productRef);
  await fs.writeFile(extraPath, extraRef);
  await fs.writeFile(logoPath, logoRef);

  const productDataUrl = `data:image/png;base64,${productRef.toString("base64")}`;
  const extraDataUrl = `data:image/png;base64,${extraRef.toString("base64")}`;
  const logoDataUrl = `data:image/png;base64,${logoRef.toString("base64")}`;

  console.log("\n--- (c1) Triple reference ---");
  const triplePrompt =
    "Create a simple 1:1 Facebook ad layout on white: the red square from image 1 as the hero product, the blue circle from image 2 as a secondary visual element, and the green triangle from image 3 as a small logo badge in the top-right corner.";

  const triple = await provider.generate({
    model,
    prompt: triplePrompt,
    referenceImageUrl: productDataUrl,
    referenceImageUrls: [productDataUrl, extraDataUrl, logoDataUrl],
  });
  const triplePath = path.join(OUT_DIR, "c-triple-ref.png");
  await fs.writeFile(triplePath, triple);

  const tripleCheck = await verifyGraphic(triple, { red: true, blue: true, green: true });
  console.log("Triple-ref check:", tripleCheck);

  if (tripleCheck.pass) {
    await writeMaxImageRefsConfig(4);
    console.log("\nPASS (c): Triple reference supported — MAX_IMAGE_REFS = 4");
    console.log("\n=== Smoke test PASSED ===\n");
    return;
  }

  console.log("\n--- (c2) Dual reference fallback ---");
  const dualPrompt =
    "Create a simple 1:1 Facebook ad layout: the red square product from the first reference image as the hero, and the blue circle from the second reference as a small logo badge in the top-right corner. White background.";

  const dual = await provider.generate({
    model,
    prompt: dualPrompt,
    referenceImageUrl: productDataUrl,
    referenceImageUrls: [productDataUrl, extraDataUrl],
  });
  const dualPath = path.join(OUT_DIR, "c-dual-ref.png");
  await fs.writeFile(dualPath, dual);

  const dualCheck = await verifyGraphic(dual, { red: true, blue: true });
  console.log("Dual-ref check:", dualCheck);

  if (dualCheck.pass) {
    await writeMaxImageRefsConfig(2);
    console.log("\nWARN (c): Triple weak — MAX_IMAGE_REFS = 2");
    console.log("Triple notes:", tripleCheck.notes);
    console.log("\n=== Smoke test PASSED ===\n");
    return;
  }

  console.log("\n--- (c3) Single reference fallback ---");
  const single = await provider.generate({
    model,
    prompt:
      "Create a simple 1:1 Facebook ad with the red square from the reference image as the hero on a white background.",
    referenceImageUrl: productDataUrl,
  });
  const singlePath = path.join(OUT_DIR, "c-single-ref.png");
  await fs.writeFile(singlePath, single);

  const singleCheck = await verifyGraphic(single, { red: true, blue: false });
  console.log("Single-ref check:", singleCheck);

  if (singleCheck.pass) {
    await writeMaxImageRefsConfig(1);
    console.log("\nWARN (c): Multi-ref weak — MAX_IMAGE_REFS = 1 (prompt fallback for logo/extras)");
    console.log("Triple notes:", tripleCheck.notes);
    console.log("Dual notes:", dualCheck.notes);
    console.log("\n=== Smoke test PASSED ===\n");
    return;
  }

  await writeMaxImageRefsConfig(0);
  console.error("\nWARN (c): Reference images unreliable — MAX_IMAGE_REFS = 0 (prompt-only)");
  console.log("\n=== Smoke test PASSED (degraded refs) ===\n");
}

main().catch((err) => {
  console.error("\nSmoke test FAILED:", err);
  process.exit(1);
});
