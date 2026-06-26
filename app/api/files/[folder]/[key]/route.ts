import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ folder: string; key: string }> }
) {
  const { folder, key } = await params;
  if (folder !== "uploads" && folder !== "generated") {
    return NextResponse.json({ error: "Invalid folder" }, { status: 400 });
  }
  const filePath = path.join(process.cwd(), folder, key);
  try {
    const buf = await fs.readFile(filePath);
    const mime = key.endsWith(".png") ? "image/png" : "image/jpeg";
    return new NextResponse(buf, { headers: { "Content-Type": mime } });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
