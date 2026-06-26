import type { ProjectEvent } from "@/lib/events/emit";

type Listener = (message: string) => void;

const listenersByProject = new Map<string, Set<Listener>>();

/** In-process fan-out when Redis is unavailable (inline dev pipeline). */
export function publishLocalProjectEvent(event: ProjectEvent): void {
  const listeners = listenersByProject.get(event.projectId);
  if (!listeners?.size) return;
  const message = JSON.stringify(event);
  listeners.forEach((listener) => listener(message));
}

export function subscribeLocalProjectEvents(
  projectId: string,
  listener: Listener
): () => void {
  if (!listenersByProject.has(projectId)) {
    listenersByProject.set(projectId, new Set());
  }
  listenersByProject.get(projectId)!.add(listener);
  return () => {
    listenersByProject.get(projectId)?.delete(listener);
  };
}
