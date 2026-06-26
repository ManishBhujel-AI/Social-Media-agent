import Redis, { type RedisOptions } from "ioredis";

export function redisRetryStrategy(times: number): number | null {
  if (times > 25) return null;
  return Math.min(200 + times * 200, 5000);
}

export function redisReconnectOnError(err: Error): boolean {
  const msg = err.message ?? "";
  return /ECONNRESET|ETIMEDOUT|READONLY|EPIPE/i.test(msg);
}

export function getRedisClientOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
    reconnectOnError: redisReconnectOnError,
  };
}

export function getBullMqConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set");
  return {
    url,
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
    reconnectOnError: redisReconnectOnError,
  };
}

let publisher: Redis | null = null;

export function getRedisPublisher(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (!publisher) {
    publisher = new Redis(url, getRedisClientOptions());
    publisher.on("error", (err) => {
      console.warn("[redis publisher]", err.message);
    });
  }
  return publisher;
}
