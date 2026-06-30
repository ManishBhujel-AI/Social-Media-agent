import { continuePostAgentFromSavedState } from "@/lib/ai/agents/postAgent";
import { prisma } from "@/lib/db/prisma";

const taskId = process.argv[2] ?? "cmqz4nnac0047ujl0o6yz5ngo";

async function main() {
  console.log("Resuming task", taskId);
  const before = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, statusLabel: true, caption: true, agentState: true },
  });
  console.log("before", JSON.stringify(before, null, 2));

  const result = await continuePostAgentFromSavedState(taskId);
  console.log("result", result);

  const after = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true, statusLabel: true, caption: true, agentState: true },
  });
  console.log("after", JSON.stringify(after, null, 2));
}

main()
  .catch((e) => {
    console.error("ERROR", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
