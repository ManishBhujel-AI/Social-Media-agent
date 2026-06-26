import { NextRequest } from "next/server";
import Redis from "ioredis";
import { PROJECT_CHANNEL } from "@/lib/events/emit";
import { subscribeLocalProjectEvents } from "@/lib/events/localBus";
import { getRedisClientOptions } from "@/lib/redis/client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let subscriber: Redis | null = null;
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;

      const send = (data: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        subscriber?.disconnect();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      try {
        const unsubLocal = subscribeLocalProjectEvents(projectId, send);

        if (process.env.REDIS_URL) {
          subscriber = new Redis(process.env.REDIS_URL, getRedisClientOptions());
          subscriber.on("error", (err) => {
            console.warn("[redis subscriber]", err.message);
          });
          await subscriber.subscribe(PROJECT_CHANNEL(projectId));
          subscriber.on("message", (_ch, message) => send(message));
        }

        req.signal.addEventListener("abort", () => {
          unsubLocal();
          cleanup();
        });
      } catch {
        /* client falls back to polling */
      }

      heartbeat = setInterval(() => send(JSON.stringify({ type: "heartbeat" })), 15000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
