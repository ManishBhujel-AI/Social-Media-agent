import { createWorker } from "@/lib/queue/bullmq";
import { prisma } from "@/lib/db/prisma";
import { processJob } from "@/lib/queue/handlers";

const worker = createWorker(async (job) => {
  await processJob(job.name, job.data);
});

worker.on("failed", (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

async function shutdown() {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

console.log("Brewline worker started (PIPELINE_CONCURRENCY=%s)", process.env.PIPELINE_CONCURRENCY ?? 1);
