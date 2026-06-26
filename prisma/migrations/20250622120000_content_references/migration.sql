-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "contentReferences" JSONB;

-- AlterTable
ALTER TABLE "UploadedImage" ADD COLUMN IF NOT EXISTS "referenceKind" TEXT;
ALTER TABLE "UploadedImage" ADD COLUMN IF NOT EXISTS "referenceMeta" JSONB;
