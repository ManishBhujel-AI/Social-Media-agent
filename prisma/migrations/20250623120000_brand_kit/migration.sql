-- Brand kit: client-scoped brand data linked to projects

CREATE TABLE IF NOT EXISTS "BrandKit" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "website" TEXT,
    "kit" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandKit_domain_key" ON "BrandKit"("domain");

ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "brandKitId" TEXT;

DO $$ BEGIN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_brandKitId_fkey"
        FOREIGN KEY ("brandKitId") REFERENCES "BrandKit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
