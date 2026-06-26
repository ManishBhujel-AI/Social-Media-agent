import { Queue, Worker, type JobsOptions, type ConnectionOptions } from "bullmq";
import { prisma } from "@/lib/db/prisma";
import { withTransientRetry } from "@/lib/db/transientRetry";
import { getBullMqConnection } from "@/lib/redis/client";

export type JobType =
  | "ANALYZE_IMAGES"
  | "RUN_TASK_AGENT"
  | "RESUME_TASK_AGENT"
  | "APPLY_FEEDBACK";

let queue: Queue | null = null;

function getConnection(): ConnectionOptions {
  return getBullMqConnection();
}

async function updateJobStatus(
  jobId: string,
  data: { status: string; error?: string }
): Promise<void> {
  await withTransientRetry(
    () =>
      prisma.job.update({
        where: { id: jobId },
        data: data as never,
      }),
    { label: `job status ${data.status}` }
  );
}

export function getQueue(): Queue {
  if (!queue) {
    queue = new Queue("brewline-jobs", { connection: getConnection() });
  }
  return queue;
}

export async function enqueueJob(params: {
  type: JobType;
  projectId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  opts?: JobsOptions;
}): Promise<string> {
  const job = await withTransientRetry(
    () =>
      prisma.job.create({
        data: {
          type: params.type,
          projectId: params.projectId,
          taskId: params.taskId,
          payload: params.payload as object,
          status: "queued",
        },
      }),
    { label: "job create" }
  );

  await getQueue().add(params.type, { jobId: job.id, ...params.payload }, {
    jobId: job.id,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    ...params.opts,
  });

  return job.id;
}

export function createWorker(
  processor: (job: { name: string; data: Record<string, unknown> }) => Promise<void>
) {
  return new Worker(
    "brewline-jobs",
    async (job) => {
      const jobId = (job.data.jobId as string) ?? job.id!;
      await updateJobStatus(jobId, { status: "running" });
      try {
        await processor({ name: job.name, data: job.data as Record<string, unknown> });
        await updateJobStatus(jobId, { status: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const maxAttempts = job.opts.attempts ?? 1;
        const isFinalAttempt = job.attemptsMade >= maxAttempts;
        try {
          await updateJobStatus(jobId, {
            status: isFinalAttempt ? "failed" : "retrying",
            ...(isFinalAttempt ? { error: msg } : {}),
          });
        } catch (statusErr) {
          console.error(`Failed to persist job failure for ${jobId}:`, statusErr);
        }
        throw err;
      }
    },
    {
      connection: getConnection(),
      concurrency: Number(process.env.PIPELINE_CONCURRENCY ?? 1),
    }
  );
}
