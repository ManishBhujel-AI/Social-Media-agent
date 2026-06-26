/** Client-safe task pause predicates — no server/DB imports. */

export function taskHasAssignedImage(task: {
  sourceImages: unknown;
  productImageUrl: string | null;
}): boolean {
  const urls = (task.sourceImages as string[] | null) ?? [];
  return urls.length > 0 || Boolean(task.productImageUrl);
}

export function isUserPausedTask(
  task: Pick<{ statusLabel: string | null; agentState: unknown }, "statusLabel" | "agentState">
): boolean {
  if (task.statusLabel === "Paused") return true;
  if (!task.agentState || typeof task.agentState !== "object") return false;
  return Boolean((task.agentState as { userPaused?: boolean }).userPaused);
}

export function isPreImageRequestState(agentState: unknown): boolean {
  if (!agentState || typeof agentState !== "object") return false;
  const state = agentState as { preImageRequest?: boolean; pendingToolCallId?: string };
  // Agent questions save pendingToolCallId — never treat those as photo-collection pauses.
  if (state.pendingToolCallId) return false;
  return Boolean(state.preImageRequest);
}

/** Post is paused on a clarifying question (not photo collection). */
export function isAgentQuestionPause(
  task: Pick<{ status: string; agentState: unknown; pendingQuestion: string | null }, "status" | "agentState" | "pendingQuestion">
): boolean {
  if (task.status !== "NEEDS_INFO") return false;
  if (isPreImageRequestState(task.agentState)) return false;
  return Boolean(task.pendingQuestion?.trim());
}
