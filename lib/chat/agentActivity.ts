import { emitProjectEvent } from "@/lib/events/emit";

export async function emitAgentActivity(
  projectId: string,
  payload: { label: string; toolName?: string }
) {
  await emitProjectEvent({
    type: "agent.activity",
    projectId,
    payload,
  });
}
