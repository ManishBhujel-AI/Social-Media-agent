import { NextRequest, NextResponse } from "next/server";
import { deleteConversationWithTasks } from "@/lib/conversations/deleteConversation";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;

  try {
    const result = await deleteConversationWithTasks(conversationId);
    if (!result) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      projectId: result.projectId,
      deletedId: result.deletedId,
      deletedTaskCount: result.deletedTaskIds.length,
    });
  } catch (err) {
    console.error("[DELETE /api/conversations]", conversationId, err);
    return NextResponse.json({ error: "Could not delete chat. Try again." }, { status: 500 });
  }
}
