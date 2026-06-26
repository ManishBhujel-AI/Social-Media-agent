import { getRedisPublisher } from "@/lib/redis/client";

const PAUSE_KEY = (projectId: string) => `brewline:pipeline:paused:${projectId}`;

const localPaused = new Map<string, boolean>();

export async function isProjectPipelinePaused(projectId: string): Promise<boolean> {
  const redis = getRedisPublisher();
  if (redis) {
    try {
      return (await redis.get(PAUSE_KEY(projectId))) === "1";
    } catch {
      /* fall through */
    }
  }
  return localPaused.get(projectId) ?? false;
}

export async function setProjectPipelinePaused(
  projectId: string,
  paused: boolean
): Promise<void> {
  const redis = getRedisPublisher();
  if (redis) {
    try {
      if (paused) await redis.set(PAUSE_KEY(projectId), "1");
      else await redis.del(PAUSE_KEY(projectId));
    } catch {
      /* fall through */
    }
  }
  if (paused) localPaused.set(projectId, true);
  else localPaused.delete(projectId);
}
