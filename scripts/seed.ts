import { prisma } from "../lib/db/prisma";
import { applyDefaultedFields } from "../lib/brandKit/defaults";
import {
  buildCoscoBrandKit,
  buildCoscoCaptionCorpus,
  COSCO_BRAND_KIT_DOMAIN,
  COSCO_CONVERSATION_ID,
  COSCO_PROJECT_ID,
} from "../lib/seed/coscoKit";

async function seedCosco() {
  const kit = applyDefaultedFields(buildCoscoBrandKit());
  const captionCorpus = buildCoscoCaptionCorpus();

  const brandKit = await prisma.brandKit.upsert({
    where: { domain: COSCO_BRAND_KIT_DOMAIN },
    update: {
      website: "https://coscohawaii.com",
      kit: kit as object,
    },
    create: {
      domain: COSCO_BRAND_KIT_DOMAIN,
      website: "https://coscohawaii.com",
      kit: kit as object,
    },
  });

  const project = await prisma.project.upsert({
    where: { id: COSCO_PROJECT_ID },
    update: {
      name: "Cosco Hawaii",
      clientUrl: "https://coscohawaii.com",
      brandKitId: brandKit.id,
      captionCorpus,
      contentReferences: [],
    },
    create: {
      id: COSCO_PROJECT_ID,
      name: "Cosco Hawaii",
      clientUrl: "https://coscohawaii.com",
      brandKitId: brandKit.id,
      captionCorpus,
      contentReferences: [],
    },
  });

  const conversation = await prisma.conversation.upsert({
    where: { id: COSCO_CONVERSATION_ID },
    update: { projectId: project.id },
    create: {
      id: COSCO_CONVERSATION_ID,
      projectId: project.id,
    },
  });

  console.log("Seeded Cosco Hawaii workspace:");
  console.log("  project:", project.id);
  console.log("  brandKit:", brandKit.id, `(${COSCO_BRAND_KIT_DOMAIN})`);
  console.log("  conversation:", conversation.id);
  console.log("  preferences:", kit.clientPreferences.length);
  console.log("  productNotes:", Object.keys(kit.productNotes).length);
  console.log("  captionCorpus:", captionCorpus.length, "chars");
}

async function main() {
  await seedCosco();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
