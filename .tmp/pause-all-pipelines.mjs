#!/usr/bin/env tsx
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// lib/db/prisma.ts
var import_client, globalForPrisma, prisma;
var init_prisma = __esm({
  "lib/db/prisma.ts"() {
    "use strict";
    import_client = require("@prisma/client");
    globalForPrisma = globalThis;
    prisma = globalForPrisma.prisma ?? new import_client.PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
    });
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  }
});

// lib/events/emit.ts
var PROJECT_CHANNEL;
var init_emit = __esm({
  "lib/events/emit.ts"() {
    "use strict";
    init_publish();
    PROJECT_CHANNEL = (projectId) => `project:${projectId}`;
  }
});

// lib/db/transientRetry.ts
function isTransientConnectionError(err) {
  if (!err || typeof err !== "object") {
    const msg = String(err);
    return TRANSIENT_RE.test(msg);
  }
  const e = err;
  if (e.code && TRANSIENT_PRISMA_CODES.has(e.code)) return true;
  if (e.code === "ECONNRESET" || e.code === "ETIMEDOUT") return true;
  if (e.message && TRANSIENT_RE.test(e.message)) return true;
  return false;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withTransientRetry(fn, opts) {
  const attempts = opts?.attempts ?? 4;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientConnectionError(err) || i === attempts - 1) throw err;
      const delay = 150 * (i + 1);
      console.warn(
        `[transient-retry] ${opts?.label ?? "operation"} attempt ${i + 1}/${attempts} failed, retrying in ${delay}ms:`,
        err instanceof Error ? err.message : err
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}
var TRANSIENT_RE, TRANSIENT_PRISMA_CODES;
var init_transientRetry = __esm({
  "lib/db/transientRetry.ts"() {
    "use strict";
    TRANSIENT_RE = /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|ENOTFOUND|socket hang up|Connection terminated|connection lost|Client has encountered a connection error|Can't reach database server/i;
    TRANSIENT_PRISMA_CODES = /* @__PURE__ */ new Set([
      "P1001",
      "P1002",
      "P1008",
      "P1017",
      "P2024"
    ]);
  }
});

// lib/redis/client.ts
function redisRetryStrategy(times) {
  if (times > 25) return null;
  return Math.min(200 + times * 200, 5e3);
}
function redisReconnectOnError(err) {
  const msg = err.message ?? "";
  return /ECONNRESET|ETIMEDOUT|READONLY|EPIPE/i.test(msg);
}
function getRedisClientOptions() {
  return {
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
    reconnectOnError: redisReconnectOnError
  };
}
function getRedisPublisher() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!publisher) {
    publisher = new import_ioredis.default(url, getRedisClientOptions());
  }
  return publisher;
}
var import_ioredis, publisher;
var init_client = __esm({
  "lib/redis/client.ts"() {
    "use strict";
    import_ioredis = __toESM(require("ioredis"));
    publisher = null;
  }
});

// lib/events/publish.ts
async function publishProjectEvent(event) {
  const publisher2 = getRedisPublisher();
  if (!publisher2) return;
  await withTransientRetry(
    () => publisher2.publish(PROJECT_CHANNEL(event.projectId), JSON.stringify(event)),
    { label: `redis publish ${event.type}` }
  );
}
var init_publish = __esm({
  "lib/events/publish.ts"() {
    "use strict";
    init_emit();
    init_transientRetry();
    init_client();
  }
});

// lib/tasks/taskStream.ts
function taskToStreamPayload(task) {
  return {
    taskId: task.id,
    status: task.status,
    statusLabel: task.statusLabel,
    pendingQuestion: task.pendingQuestion,
    title: task.title,
    orderIndex: task.orderIndex,
    subject: task.subject
  };
}
var init_taskStream = __esm({
  "lib/tasks/taskStream.ts"() {
    "use strict";
  }
});

// lib/tasks/taskEvents.ts
function taskToEventPayload(task) {
  return taskToStreamPayload(task);
}
async function emitTaskUpdated(task) {
  try {
    await publishProjectEvent({
      type: "task.updated",
      projectId: task.projectId,
      payload: taskToEventPayload(task)
    });
  } catch (err) {
    console.warn("emitTaskUpdated failed after retries:", err);
  }
}
async function updateTaskFields(taskId, data) {
  const task = await withTransientRetry(
    () => prisma.task.update({
      where: { id: taskId },
      data
    }),
    { label: "updateTaskFields" }
  );
  await emitTaskUpdated(task);
  return task;
}
var init_taskEvents = __esm({
  "lib/tasks/taskEvents.ts"() {
    "use strict";
    init_prisma();
    init_publish();
    init_transientRetry();
    init_taskStream();
  }
});

// lib/queue/bullmq.ts
var import_bullmq;
var init_bullmq = __esm({
  "lib/queue/bullmq.ts"() {
    "use strict";
    import_bullmq = require("bullmq");
    init_prisma();
    init_transientRetry();
    init_client();
  }
});

// lib/queue/pipelinePauseFlag.ts
async function setProjectPipelinePaused(projectId, paused) {
  const redis = getRedisPublisher();
  if (redis) {
    try {
      if (paused) await redis.set(PAUSE_KEY(projectId), "1");
      else await redis.del(PAUSE_KEY(projectId));
    } catch {
    }
  }
  if (paused) localPaused.set(projectId, true);
  else localPaused.delete(projectId);
}
var PAUSE_KEY, localPaused;
var init_pipelinePauseFlag = __esm({
  "lib/queue/pipelinePauseFlag.ts"() {
    "use strict";
    init_client();
    PAUSE_KEY = (projectId) => `brewline:pipeline:paused:${projectId}`;
    localPaused = /* @__PURE__ */ new Map();
  }
});

// lib/queue/dispatch.ts
var init_dispatch = __esm({
  "lib/queue/dispatch.ts"() {
    "use strict";
    init_bullmq();
    init_pipelinePauseFlag();
  }
});

// lib/tasks/pendingTask.ts
var init_pendingTask = __esm({
  "lib/tasks/pendingTask.ts"() {
    "use strict";
  }
});

// lib/chat/messageEvents.ts
var init_messageEvents = __esm({
  "lib/chat/messageEvents.ts"() {
    "use strict";
    init_emit();
  }
});

// lib/ai/agents/postImageRequest.ts
var init_postImageRequest = __esm({
  "lib/ai/agents/postImageRequest.ts"() {
    "use strict";
    init_prisma();
    init_messageEvents();
    init_taskEvents();
  }
});

// lib/queue/pipelineGate.ts
var init_pipelineGate = __esm({
  "lib/queue/pipelineGate.ts"() {
    "use strict";
    init_prisma();
    init_dispatch();
    init_pendingTask();
    init_postImageRequest();
  }
});

// scripts/pause-all-pipelines.ts
init_prisma();

// lib/queue/pipelinePause.ts
init_prisma();
init_taskEvents();
init_dispatch();
init_pipelineGate();
init_pipelinePauseFlag();
var IN_PROGRESS = [
  "AGENT_RUNNING",
  "WRITING_CAPTION",
  "WRITING_PROMPT",
  "GENERATING_IMAGE"
];
async function pauseProjectPipeline(projectId) {
  await setProjectPipelinePaused(projectId, true);
  const running = await prisma.task.findMany({
    where: { projectId, status: { in: IN_PROGRESS } }
  });
  for (const task of running) {
    await updateTaskFields(task.id, {
      statusLabel: "Paused",
      agentState: {
        ...task.agentState ?? {},
        userPaused: true,
        pausedAtStatus: task.status
      }
    });
  }
  return running.length;
}

// scripts/pause-all-pipelines.ts
async function main() {
  const projects = await prisma.project.findMany({
    select: { id: true, name: true },
    orderBy: { createdAt: "desc" }
  });
  for (const project of projects) {
    const pausedCount = await pauseProjectPipeline(project.id);
    console.log(`Paused ${project.name} (${pausedCount} running task(s) flagged)`);
  }
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
