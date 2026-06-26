-- Add graphicCopy column to Task for on-graphic copy persistence
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "graphicCopy" JSONB;
