#!/usr/bin/env tsx
import { processJob } from "../lib/queue/handlers";

const taskId = process.argv.find((a) => a.startsWith("--taskId="))?.split("=")[1];
if (!taskId) {
  console.error("Usage: tsx scripts/run-pipeline-once.ts --taskId=<id>");
  process.exit(1);
}

async function run() {
  console.log("Running post agent for task", taskId);
  await processJob("RUN_TASK_AGENT", { taskId, remainingTaskIds: [] });
  console.log("Post agent complete for", taskId);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
