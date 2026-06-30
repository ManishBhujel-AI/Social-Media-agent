import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import type { SettingsProposalMeta } from "@/lib/brandKit/settingsProposals";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const status =
    body && typeof body === "object" && (body as { status?: unknown }).status === "declined"
      ? "declined"
      : (body as { status?: unknown }).status === "applied"
        ? "applied"
        : null;

  if (!status) {
    return NextResponse.json({ error: "status must be applied or declined" }, { status: 400 });
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: { select: { projectId: true } } },
  });

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const meta = message.meta as SettingsProposalMeta | null;
  if (!meta || meta.type !== "settings_proposal") {
    return NextResponse.json({ error: "Not a settings proposal message" }, { status: 400 });
  }

  if (meta.status !== "pending") {
    return NextResponse.json({ error: "Proposal already resolved" }, { status: 409 });
  }

  const changelogEntryId =
    body && typeof body === "object" && typeof (body as { changelogEntryId?: unknown }).changelogEntryId === "string"
      ? (body as { changelogEntryId: string }).changelogEntryId
      : undefined;

  const updatedMeta: SettingsProposalMeta = {
    ...meta,
    status,
    ...(changelogEntryId ? { changelogEntryId } : {}),
  };

  await prisma.message.update({
    where: { id: messageId },
    data: { meta: updatedMeta as object },
  });

  return NextResponse.json({ ok: true, status });
}
