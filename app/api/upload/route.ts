import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getStorage } from "@/lib/storage";

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  const projectId = form.get("projectId") as string;
  if (!file || !projectId) {
    return NextResponse.json({ error: "file and projectId required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = file.type || "image/jpeg";
  const saved = await getStorage().saveUpload(buffer, mime);

  const img = await prisma.uploadedImage.create({
    data: { projectId, blobUrl: saved.url, mime },
  });

  return NextResponse.json({ imageId: img.id, url: saved.url });
}
