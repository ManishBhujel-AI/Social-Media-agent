import { PROJECT_CHANNEL, type ProjectEvent } from "@/lib/events/emit";
import { publishLocalProjectEvent } from "@/lib/events/localBus";
import { withTransientRetry } from "@/lib/db/transientRetry";
import { getRedisPublisher } from "@/lib/redis/client";

export async function publishProjectEvent(event: ProjectEvent): Promise<void> {
  publishLocalProjectEvent(event);

  const publisher = getRedisPublisher();
  if (!publisher) return;

  await withTransientRetry(
    () => publisher.publish(PROJECT_CHANNEL(event.projectId), JSON.stringify(event)),
    { label: `redis publish ${event.type}` }
  );
}
