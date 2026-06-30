import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCaptionCorpus, setCaptionCorpus } from "@/lib/content/captionCorpus";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const corpus = await getCaptionCorpus(id);
    return NextResponse.json({ corpus });
  } catch (err) {
    console.error("[caption-corpus] GET failed:", err);
    return NextResponse.json({ error: "Could not load captions" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  if (typeof body.corpus !== "string") {
    return NextResponse.json({ error: "corpus must be a string" }, { status: 400 });
  }

  try {
    const result = await setCaptionCorpus(id, body.corpus);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[caption-corpus] PATCH failed:", err);
    const isPoolBusy =
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2024";
    const message = isPoolBusy
      ? "Database connection pool busy — wait a moment and try again"
      : "Could not save captions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
