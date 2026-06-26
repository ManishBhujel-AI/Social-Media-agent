import { prisma } from "../lib/db/prisma";

async function main() {
  const project = await prisma.project.upsert({
    where: { id: "demo-project" },
    update: {},
    create: {
      id: "demo-project",
      name: "Roastery Collective",
      clientUrl: "https://roasterycollective.com",
      businessInfo: {
        businessName: "Roastery Collective",
        tagline: "Small-batch coffee, big heart",
        tone: "warm, friendly, not too salesy",
        industry: "coffee roastery",
        products: [
          { name: "Summer Cold Brew", description: "Slow-steeped 18 hours" },
          { name: "Ethiopia Single-Origin", description: "Bright floral notes" },
          { name: "Oat Matcha Latte", description: "Stone-ground matcha" },
        ],
      },
    },
  });

  const conversation = await prisma.conversation.upsert({
    where: { id: "demo-conversation" },
    update: {},
    create: {
      id: "demo-conversation",
      projectId: project.id,
    },
  });

  console.log("Seeded project:", project.id, "conversation:", conversation.id);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
