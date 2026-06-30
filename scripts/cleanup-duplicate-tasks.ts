/**
 * Cleanup duplicate tasks per subject, or wipe all tasks for a project.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-duplicate-tasks.ts [projectId]
 *   npx tsx --env-file-if-exists=.env scripts/cleanup-duplicate-tasks.ts [projectId] --wipe
 */
import { prisma } from "../lib/db/prisma";
import type { Task, TaskStatus } from "@prisma/client";
import { COSCO_PROJECT_ID } from "../lib/seed/coscoKit";
import { taskHasAssignedImage } from "../lib/tasks/taskPauseState";

const STATUS_RANK: Record<TaskStatus, number> = {
  APPROVED: 10,
  CHANGES_REQUESTED: 9,
  NEEDS_APPROVAL: 8,
  GENERATING_IMAGE: 7,
  WRITING_PROMPT: 6,
  WRITING_CAPTION: 5,
  AGENT_RUNNING: 4,
  NEEDS_INFO: 3,
  FAILED: 2,
  NOT_STARTED: 1,
};

function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase();
}

function taskScore(task: Task): number {
  let score = STATUS_RANK[task.status] ?? 0;
  if (taskHasAssignedImage(task)) score += 100;
  if (task.caption?.trim()) score += 20;
  return score;
}

function pickCanonical(tasks: Task[]): Task {
  return [...tasks].sort((a, b) => {
    const scoreDiff = taskScore(b) - taskScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  })[0]!;
}

async function cleanupDuplicateImageRequestMessages(
  conversationIds: string[],
  removedTaskIds: Set<string>
): Promise<number> {
  if (!conversationIds.length || !removedTaskIds.size) return 0;

  const messages = await prisma.message.findMany({
    where: {
      conversationId: { in: conversationIds },
      role: "assistant",
    },
    select: { id: true, meta: true },
  });

  const toDelete = messages.filter((m) => {
    if (!m.meta || typeof m.meta !== "object") return false;
    const meta = m.meta as { type?: string; taskId?: string };
    return meta.type === "image_request" && meta.taskId && removedTaskIds.has(meta.taskId);
  });

  if (!toDelete.length) return 0;

  await prisma.message.deleteMany({
    where: { id: { in: toDelete.map((m) => m.id) } },
  });
  return toDelete.length;
}

async function wipeAllTasks(projectId: string) {
  const tasks = await prisma.task.findMany({
    where: { projectId },
    select: { id: true, subject: true, status: true },
  });

  if (!tasks.length) {
    console.log("No tasks to wipe.");
    return;
  }

  console.log(`Wiping ${tasks.length} tasks:`);
  for (const t of tasks) {
    console.log(`  ${t.subject} (${t.status}) ${t.id.slice(-8)}`);
  }

  const taskIds = tasks.map((t) => t.id);
  const conversations = await prisma.conversation.findMany({
    where: { projectId },
    select: { id: true },
  });

  const deletedJobs = await prisma.job.deleteMany({
    where: { taskId: { in: taskIds } },
  });

  const deletedMessages = await cleanupDuplicateImageRequestMessages(
    conversations.map((c) => c.id),
    new Set(taskIds)
  );

  const deletedTasks = await prisma.task.deleteMany({
    where: { id: { in: taskIds } },
  });

  console.log("\nWipe complete:");
  console.log(`  Tasks deleted: ${deletedTasks.count}`);
  console.log(`  Jobs deleted: ${deletedJobs.count}`);
  console.log(`  Image-request messages deleted: ${deletedMessages}`);
}

async function main() {
  const args = process.argv.slice(2);
  const wipe = args.includes("--wipe");
  const projectId = args.find((a) => !a.startsWith("--")) ?? COSCO_PROJECT_ID;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    console.error(`Project not found: ${projectId}`);
    process.exit(1);
  }

  console.log(`Project: ${project.name} (${projectId})`);

  if (wipe) {
    await wipeAllTasks(projectId);
    await prisma.$disconnect();
    return;
  }

  const tasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Tasks before cleanup: ${tasks.length}`);

  const bySubject = new Map<string, Task[]>();
  for (const task of tasks) {
    const key = normalizeSubject(task.subject);
    const list = bySubject.get(key) ?? [];
    list.push(task);
    bySubject.set(key, list);
  }

  const keepIds = new Set<string>();
  const removeIds: string[] = [];

  for (const [subject, group] of bySubject) {
    if (group.length === 1) {
      keepIds.add(group[0]!.id);
      continue;
    }

    const canonical = pickCanonical(group);
    keepIds.add(canonical.id);
    const dupes = group.filter((t) => t.id !== canonical.id);
    removeIds.push(...dupes.map((t) => t.id));

    console.log(`\n${subject}: keep ${canonical.id.slice(-8)} (${canonical.status})`);
    for (const d of dupes) {
      console.log(`  remove ${d.id.slice(-8)} (${d.status}, order ${d.orderIndex})`);
    }
  }

  if (!removeIds.length) {
    console.log("\nNo duplicate tasks to remove.");
    await reindexTasks(projectId, [...keepIds]);
    await printRemainingTasks(projectId);
    await prisma.$disconnect();
    return;
  }

  const removedSet = new Set(removeIds);

  const conversations = await prisma.conversation.findMany({
    where: { projectId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const deletedJobs = await prisma.job.deleteMany({
    where: { taskId: { in: removeIds } },
  });

  const deletedMessages = await cleanupDuplicateImageRequestMessages(
    conversationIds,
    removedSet
  );

  const deletedTasks = await prisma.task.deleteMany({
    where: { id: { in: removeIds } },
  });

  await reindexTasks(projectId, [...keepIds]);

  const remaining = await prisma.task.count({ where: { projectId } });

  console.log("\nCleanup complete:");
  console.log(`  Tasks deleted: ${deletedTasks.count}`);
  console.log(`  Jobs deleted: ${deletedJobs.count}`);
  console.log(`  Image-request messages deleted: ${deletedMessages}`);
  console.log(`  Tasks remaining: ${remaining}`);

  await printRemainingTasks(projectId);

  await prisma.$disconnect();
}

async function printRemainingTasks(projectId: string) {
  const finalTasks = await prisma.task.findMany({
    where: { projectId },
    orderBy: { orderIndex: "asc" },
    select: { orderIndex: true, subject: true, status: true, id: true },
  });
  console.log("\nRemaining tasks:");
  for (const t of finalTasks) {
    console.log(`  ${t.orderIndex}. ${t.subject} (${t.status}) ${t.id.slice(-8)}`);
  }
}

async function reindexTasks(projectId: string, keepIds: string[]) {
  const remaining = await prisma.task.findMany({
    where: { projectId, id: { in: keepIds } },
    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
  });

  for (let i = 0; i < remaining.length; i++) {
    const task = remaining[i]!;
    if (task.orderIndex !== i) {
      await prisma.task.update({
        where: { id: task.id },
        data: { orderIndex: i },
      });
    }
  }
  console.log(`\nReindexed ${remaining.length} tasks (orderIndex 0–${remaining.length - 1})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
