# Brewline Content Studio

AI social media content agent — chat brief → pipeline → approval board.

## Stack

- **App:** Next.js 14 on Vercel
- **Worker:** `scripts/worker.ts` on Railway (always-on)
- **Database:** Neon Postgres
- **Queue:** BullMQ on **Railway Redis** (co-located with worker — not Upstash)
- **Storage:** Vercel Blob (prod) / local `uploads/` + `generated/` (dev)
- **AI:** OpenRouter only (`OPENROUTER_API_KEY`)

### Railway Redis + BullMQ

Redis runs on **Railway alongside the worker** (same project or linked Redis service). Share `REDIS_URL` with the Vercel app for SSE pub/sub.

BullMQ requires:

```ts
new IORedis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
```

## Local setup

```bash
cp .env.example .env
# Fill DATABASE_URL, REDIS_URL, OPENROUTER_API_KEY

npm install
npx prisma generate
npx prisma db push
npm run db:seed

# Mandatory Stage 1 gate — must pass before pipeline work
npm run test:image

# Terminal 1
npm run dev

# Terminal 2
npm run worker
```

Or: `npm run dev:all`

## Deploy

### Vercel (app only)

1. Connect repo to Vercel
2. Set env: `DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `NEXT_PUBLIC_APP_URL`
3. Do **not** run the worker on Vercel

### Railway (worker + Redis)

1. Add Redis plugin in the same Railway project as the worker
2. Deploy with start command: `npx tsx scripts/worker.ts`
3. Env: same as Vercel (`DATABASE_URL`, `REDIS_URL`, `OPENROUTER_API_KEY`, `BLOB_READ_WRITE_TOKEN`, `PIPELINE_CONCURRENCY=1`)

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run test:image` | Two-part OpenRouter image smoke test (generate + edit fidelity) |
| `npm run pipeline:once -- --taskId=<id>` | Run caption→prompt→image pipeline for one task (no UI) |
| `npm run worker` | BullMQ job processor |

## Auth

None in v1 — single-tenant. Add Clerk/NextAuth in a future release.
