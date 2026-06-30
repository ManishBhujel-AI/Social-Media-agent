ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_conversationId_fkey";
ALTER TABLE "Task" ADD CONSTRAINT "Task_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Task_conversationId_idx" ON "Task"("conversationId");
